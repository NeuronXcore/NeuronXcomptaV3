"""Router pour le rapprochement opérations / justificatifs."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.services import rapprochement_service, justificatif_service

router = APIRouter(prefix="/api/rapprochement", tags=["rapprochement"])


@router.get("/suggestions/operation/{file}/{index}")
def get_suggestions_for_operation(
    file: str,
    index: int,
    ventilation_index: Optional[int] = None,
):
    """Suggestions de justificatifs pour une opération."""
    return rapprochement_service.get_suggestions_for_operation(
        file, index, ventilation_index=ventilation_index,
    )


@router.get("/suggestions/justificatif/{filename}")
def get_suggestions_for_justificatif(filename: str):
    """Suggestions d'opérations pour un justificatif."""
    return rapprochement_service.get_suggestions_for_justificatif(filename)


@router.post("/run-auto")
def run_auto_rapprochement(
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
):
    """Lance le rapprochement automatique et retourne le rapport.

    Si `year` et `month` sont fournis, scope ±1 mois (PDFs et ops). Sinon scan
    complet. `month` requiert `year`.
    """
    if month is not None and year is None:
        raise HTTPException(status_code=400, detail="month requires year")
    return rapprochement_service.run_auto_rapprochement(year=year, month=month)


@router.get("/unmatched")
def get_unmatched():
    """Compteurs opérations/justificatifs non rapprochés."""
    return rapprochement_service.get_unmatched_summary()


@router.get("/log")
def get_auto_log(limit: int = Query(20, ge=1, le=100)):
    """Dernières associations automatiques."""
    return rapprochement_service.get_auto_log(limit)


@router.get("/batch-hints/{filename}")
def get_batch_hints(filename: str):
    """Best scores par index pour un fichier d'opérations."""
    return rapprochement_service.get_batch_hints(filename)


@router.get("/batch-justificatif-scores")
def get_batch_justificatif_scores():
    """Best score par justificatif en attente."""
    return rapprochement_service.get_batch_justificatif_scores()


@router.get("/{filename}/{index}/suggestions")
def get_filtered_suggestions(
    filename: str,
    index: int,
    montant_min: Optional[float] = None,
    montant_max: Optional[float] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    ventilation_index: Optional[int] = None,
    include_referenced: bool = Query(False),
):
    """Suggestions filtrées de justificatifs pour une opération.

    Si `include_referenced=True`, inclut aussi les PDFs déjà liés à une autre op,
    chaque suggestion étant enrichie de `is_referenced` + `referenced_by`.
    """
    return rapprochement_service.get_filtered_suggestions(
        filename, index,
        montant_min=montant_min,
        montant_max=montant_max,
        date_from=date_from,
        date_to=date_to,
        search=search,
        ventilation_index=ventilation_index,
        include_referenced=include_referenced,
    )


class ManualAssociateRequest(BaseModel):
    justificatif_filename: str
    operation_file: str
    operation_index: int
    rapprochement_score: Optional[float] = None
    ventilation_index: Optional[int] = None
    force: bool = False


@router.post("/associate-manual")
def associate_manual(req: ManualAssociateRequest):
    """Association manuelle avec métadonnées de rapprochement.

    Si `force=True` :
    - Bypass le verrouillage de l'op cible (déverrouillage automatique).
    - Bypass le check référence : si le PDF est déjà associé à une autre op,
      cascade dissociation de l'ancienne avant la nouvelle association.
    """
    # Garde lock : empêche la modification d'une association verrouillée
    from backend.services import operation_service as _op_svc_guard
    _ops_guard = _op_svc_guard.load_operations(req.operation_file)
    if 0 <= req.operation_index < len(_ops_guard) and _ops_guard[req.operation_index].get("locked"):
        if not req.force:
            raise HTTPException(
                status_code=423,
                detail="Opération verrouillée — déverrouillez avant de modifier l'association.",
            )

    # Cascade : si force=True ET le PDF est déjà référencé ailleurs, dissocier
    # l'ancienne op avant d'associer la nouvelle. Évite les liens orphelins.
    if req.force:
        try:
            previous_refs = justificatif_service.find_operations_by_justificatif(
                req.justificatif_filename
            )
            for prev in previous_refs:
                # Skip si c'est exactement la même cible (idempotence)
                if (
                    prev["operation_file"] == req.operation_file
                    and prev["operation_index"] == req.operation_index
                    and prev.get("ventilation_index") == req.ventilation_index
                ):
                    continue
                # Déverrouiller l'ancienne op si lockée (force l'autorise)
                try:
                    _prev_ops = _op_svc_guard.load_operations(prev["operation_file"])
                    if 0 <= prev["operation_index"] < len(_prev_ops):
                        _prev_op = _prev_ops[prev["operation_index"]]
                        if _prev_op.get("locked"):
                            _prev_op["locked"] = False
                            _prev_op["locked_at"] = None
                            _op_svc_guard.save_operations(
                                _prev_ops, filename=prev["operation_file"]
                            )
                except Exception:
                    pass
                # Dissocier l'ancien lien
                try:
                    justificatif_service.dissociate(
                        prev["operation_file"], prev["operation_index"]
                    )
                except Exception:
                    pass  # erreur cascade non bloquante
        except Exception:
            pass

    success = justificatif_service.associate(
        req.justificatif_filename, req.operation_file, req.operation_index
    )
    if not success:
        raise HTTPException(status_code=400, detail="Échec de l'association")

    # Set lock automatiquement : toute association manuelle verrouille l'op
    try:
        from backend.services import operation_service as _op_svc_lock
        _ops_lock = _op_svc_lock.load_operations(req.operation_file)
        if 0 <= req.operation_index < len(_ops_lock):
            _ops_lock[req.operation_index]["locked"] = True
            _ops_lock[req.operation_index]["locked_at"] = datetime.now().isoformat(timespec="seconds")
            _op_svc_lock.save_operations(_ops_lock, filename=req.operation_file)
    except Exception:
        pass  # lock non critique — l'association reste valide

    if req.ventilation_index is not None:
        # Pour une sous-ligne ventilée : écrire le justificatif dans la sous-ligne
        from backend.services import operation_service
        ops = operation_service.load_operations(req.operation_file)
        if 0 <= req.operation_index < len(ops):
            op = ops[req.operation_index]
            vlines = op.get("ventilation", [])
            if 0 <= req.ventilation_index < len(vlines):
                vlines[req.ventilation_index]["justificatif"] = req.justificatif_filename
            operation_service.save_operations(ops, filename=req.operation_file)

    rapprochement_service.write_rapprochement_metadata(
        req.operation_file,
        req.operation_index,
        req.rapprochement_score or 0.0,
        "manuel",
        ventilation_index=req.ventilation_index,
    )

    # GED V2 enrichment
    try:
        from backend.services import ged_service, operation_service as _op_svc
        _ops = _op_svc.load_operations(req.operation_file)
        if 0 <= req.operation_index < len(_ops):
            _op = _ops[req.operation_index]
            if req.ventilation_index is not None:
                _vlines = _op.get("ventilation", [])
                if 0 <= req.ventilation_index < len(_vlines):
                    _vl = _vlines[req.ventilation_index]
                    _cat = _vl.get("categorie", "")
                    _scat = _vl.get("sous_categorie", "")
                    _amount = float(_vl.get("montant", 0))
                else:
                    _cat = _op.get("Catégorie", "")
                    _scat = _op.get("Sous-catégorie", "")
                    _amount = abs(float(_op.get("Débit", 0) or 0)) or abs(float(_op.get("Crédit", 0) or 0))
            else:
                _cat = _op.get("Catégorie", "")
                _scat = _op.get("Sous-catégorie", "")
                _amount = abs(float(_op.get("Débit", 0) or 0)) or abs(float(_op.get("Crédit", 0) or 0))
            from backend.services.rapprochement_service import _load_ocr_data
            _ocr = _load_ocr_data(req.justificatif_filename)
            ged_service.enrich_metadata_on_association(
                justificatif_filename=req.justificatif_filename,
                operation_file=req.operation_file,
                operation_index=req.operation_index,
                categorie=_cat,
                sous_categorie=_scat,
                fournisseur=_ocr.get("supplier", "") if _ocr else "",
                date_operation=_op.get("Date", ""),
                montant=_amount,
                ventilation_index=req.ventilation_index,
            )
    except Exception:
        pass

    # Auto-pointage après association manuelle
    try:
        from backend.services import operation_service
        _ops_reload = operation_service.load_operations(req.operation_file)
        pointed = operation_service.maybe_auto_lettre(_ops_reload)
        if pointed > 0:
            operation_service.save_operations(_ops_reload, filename=req.operation_file)
    except Exception:
        pass

    # Auto-apprentissage d'aliases : si le score lexical fournisseur est à 0
    # mais l'utilisateur a quand même associé manuellement, ajouter le
    # libellé op normalisé à la table d'aliases pour ce fournisseur.
    # Permet à l'auto-rapprochement de capter ce pattern dans les futurs runs.
    try:
        from backend.services import (
            aliases_service,
            rapprochement_service as _rs,
            operation_service as _op_svc,
        )
        _ops_alias = _op_svc.load_operations(req.operation_file)
        if 0 <= req.operation_index < len(_ops_alias):
            _op_alias = _ops_alias[req.operation_index]
            _libelle = _op_alias.get("Libellé", "") or ""
            _ocr_alias = _rs._load_ocr_data(req.justificatif_filename)
            _supplier = (_ocr_alias.get("supplier") or "") if _ocr_alias else ""
            if _supplier and _libelle:
                # Calculer le score lexical (sans aliases) pour décider d'apprendre.
                # Réutilise score_fournisseur — si match aliases déjà actif il
                # retourne ALIAS_MATCH_SCORE (0.85), donc on regarde si <= 0.85
                # ET si pas de match lexical direct.
                from difflib import SequenceMatcher
                tokens_a = _rs._normalize_tokens(_supplier)
                tokens_b = _rs._normalize_tokens(_libelle)
                jaccard = (
                    len(tokens_a & tokens_b) / len(tokens_a | tokens_b)
                    if tokens_a and tokens_b else 0.0
                )
                import re as _re
                j_n = _re.sub(r"[^\w]", "", _supplier.lower())
                o_n = _re.sub(r"[^\w]", "", _libelle.lower())
                substring = 0.0
                if j_n and o_n and len(j_n) >= 3:
                    if j_n in o_n or o_n in j_n:
                        substring = 1.0
                    else:
                        for tok in tokens_a:
                            if len(tok) >= 3 and tok in o_n:
                                substring = max(substring, 0.85)
                lev = SequenceMatcher(None, j_n, o_n).ratio() if j_n and o_n else 0.0
                if lev < 0.5:
                    lev = 0.0
                lexical_score = max(substring, jaccard, lev)
                # Apprend uniquement si lexical=0 (pas de signal direct)
                added = aliases_service.learn_from_association(
                    _supplier, _libelle, lexical_score
                )
                if added:
                    pass  # logged inside aliases_service.learn_from_association
    except Exception:
        pass  # apprentissage non critique

    return {"success": True}
