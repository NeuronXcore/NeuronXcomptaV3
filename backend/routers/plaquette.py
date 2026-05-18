"""Router pour le module Vérification Plaquette Comptable.

Endpoints sous /api/plaquette :
  - GET  /templates                      → liste cabinets disponibles
  - GET  /mapping                        → mapping PCG complet
  - GET  /{year}                         → PlaquetteCheck (créé si absent) + auto-recalc NeuronX
  - GET  /{year}/exists                  → boolean (sans création)
  - POST /{year}/items                   → ajout item manuel
  - PATCH /{year}/items/{item_id}        → édition (montant/statut/commentaire)
  - DELETE /{year}/items/{item_id}       → suppression item
  - GET  /{year}/items/{item_id}/ops     → drill-down ops NeuronX
  - PATCH /{year}/totaux                 → édition totaux (recettes/dépenses/bénéfice)
  - POST /{year}/set-ged-ref             → lier la plaquette à un doc GED
  - POST /{year}/generate-challenge-email → texte email items "a_challenger"
  - POST /{year}/journal                 → ajout entrée journal

Session 39 P1 — Cycle de vie + snapshot + attachements :
  - PATCH /{year}/status                                          → transition statut (hors →DECLARE)
  - POST  /{year}/finalize                                        → transition atomique →DECLARE
  - POST  /{year}/journal/{entry_id}/attachments                  → upload attachement
  - GET   /{year}/journal/{entry_id}/attachments/{filename}       → preview/download inline
  - DELETE /{year}/journal/{entry_id}/attachments/{filename}      → suppression attachement
  - GET   /{year}/journal/grouped-by-item                         → vue groupée
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from backend.models.plaquette_check import (
    ComptableResponseRequest,
    ComptableResponseResult,
    FinalizePlaquetteRequest,
    GenerateChallengeEmailResponse,
    JournalEntryCreate,
    PlaquetteCheckSetRefRequest,
    PlaquetteCheckStatus,
    PlaquetteItemCreate,
    PlaquetteItemPatch,
    PlaquetteStatusUpdate,
    PlaquetteTotauxPatch,
    RisqueOverrideRequest,
)
from backend.services import (
    plaquette_finalization_service,
    plaquette_pcg_mapping_service,
    plaquette_report_service,
    plaquette_risque_service,
    plaquette_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plaquette", tags=["plaquette"])


# ─── Routes statiques (déclarées AVANT routes dynamiques /{year}) ───


@router.get("/templates")
def list_templates() -> dict:
    """Liste les cabinets comptables disponibles dans le mapping."""
    return {"templates": plaquette_pcg_mapping_service.list_templates()}


@router.get("/mapping")
def get_mapping() -> dict:
    """Retourne le mapping PCG complet (lecture seule pour l'instant)."""
    return plaquette_pcg_mapping_service.load_mapping()


# ─── Routes dynamiques par année ───


@router.get("/{year}/exists")
def year_exists(year: int) -> dict:
    """Retourne True si une plaquette_check existe pour cette année (sans création)."""
    data = plaquette_service.get(year)
    return {"exists": data is not None, "year": year}


@router.get("/{year}")
def get_year(
    year: int,
    template: str = Query("sygnatures_marenco"),
) -> dict:
    """Récupère le PlaquetteCheck de l'année (créé si absent). Recalcule montant_neuronx."""
    return plaquette_service.get_or_create(year, template=template)


@router.post("/{year}/items")
def create_item(year: int, payload: PlaquetteItemCreate) -> dict:
    """Ajout d'un item manuel.

    Session 39 P1 : refus 423 si plaquette gelée (validation_finale / declare).
    """
    try:
        return plaquette_service.add_item(year, payload)
    except PermissionError as e:
        raise HTTPException(status_code=423, detail=str(e))


@router.patch("/{year}/items/{item_id}")
def update_item(year: int, item_id: str, patch: PlaquetteItemPatch) -> dict:
    """Édition d'un item (montant_plaquette, statut, commentaire, ...).

    Session 39 P1 : refus 423 si plaquette gelée (validation_finale / declare).
    """
    try:
        return plaquette_service.patch_item(year, item_id, patch)
    except PermissionError as e:
        raise HTTPException(status_code=423, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{year}/items/{item_id}")
def remove_item(year: int, item_id: str) -> dict:
    """Session 39 P1 : refus 423 si plaquette gelée (validation_finale / declare)."""
    try:
        ok = plaquette_service.delete_item(year, item_id)
    except PermissionError as e:
        raise HTTPException(status_code=423, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Item introuvable")
    return {"status": "deleted", "item_id": item_id}


@router.get("/{year}/items/{item_id}/ops")
def drill_down(year: int, item_id: str, limit: int = Query(100, ge=1, le=500)) -> dict:
    """Drill-down ops NeuronX (filtrées par catégories mappées) pour un item."""
    ops = plaquette_service.list_drill_ops(year, item_id, limit=limit)
    return {"item_id": item_id, "nb_ops": len(ops), "operations": ops}


@router.patch("/{year}/totaux")
def update_totaux(year: int, patch: PlaquetteTotauxPatch) -> dict:
    """Édition des totaux (recettes / dépenses / bénéfice + N-1).

    Session 39 P1 : refus 423 si plaquette gelée (validation_finale / declare).
    """
    try:
        totaux = plaquette_service.patch_totaux(year, patch)
    except PermissionError as e:
        raise HTTPException(status_code=423, detail=str(e))
    return {"totaux_plaquette": totaux}


@router.post("/{year}/set-ged-ref")
def set_ged_ref(year: int, payload: PlaquetteCheckSetRefRequest) -> dict:
    """Lie la plaquette à un document GED existant (sans upload).

    Session 39 P1 : refus 423 si plaquette gelée (validation_finale / declare).
    """
    try:
        return plaquette_service.set_ged_ref(year, payload.ged_doc_id, payload.cabinet_template)
    except PermissionError as e:
        raise HTTPException(status_code=423, detail=str(e))


@router.post("/{year}/generate-challenge-email")
def generate_email(
    year: int,
    nom: Optional[str] = Query(None, description="Nom signature (défaut 'Dr Ceccoli')"),
) -> GenerateChallengeEmailResponse:
    """Construit subject + body pour envoyer un mail de challenge au comptable."""
    return plaquette_service.generate_challenge_email(year, nom=nom)


@router.post("/{year}/journal")
def add_journal(year: int, payload: JournalEntryCreate) -> dict:
    """Ajoute une entrée au journal d'échanges.

    NON guarded — toujours autorisé (même post-DECLARE) pour logger
    les questions fiscalistes post-déclaration.
    """
    return plaquette_service.add_journal_entry(year, payload)


# ─── Session 39 P1 : cycle de vie + attachements ───

# CRITIQUE : routes statiques DOIVENT être déclarées AVANT les routes dynamiques
# /journal/{entry_id}/... pour éviter le pattern matching ambigu de FastAPI.


@router.get("/{year}/journal/grouped-by-item")
def get_journal_grouped_by_item(year: int) -> dict:
    """Vue alternative du journal groupée par item (Session 39 P1)."""
    return plaquette_service.get_journal_grouped_by_item(year)


@router.patch("/{year}/status")
def patch_status(year: int, payload: PlaquetteStatusUpdate) -> dict:
    """Transition de statut (hors →DECLARE, utiliser /finalize).

    Codes :
      - 400 : transition invalide ou tentative →DECLARE sans finalize
      - 404 : année introuvable
    """
    try:
        return plaquette_finalization_service.transition_status(
            year,
            payload.new_status,
            payload.declaration_ref,
        )
    except ValueError as e:
        msg = str(e)
        if "introuvable" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.post("/{year}/finalize")
def finalize_plaquette(year: int, payload: FinalizePlaquetteRequest) -> dict:
    """Transition atomique →DECLARE : PDF watermarké + snapshot JSON + GED protégé.

    Codes :
      - 400 : status courant ≠ validation_finale OU declaration_ref vide
      - 404 : année introuvable
    """
    try:
        return plaquette_finalization_service.finalize(
            year,
            payload.declaration_ref,
            payload.declared_at,
        )
    except ValueError as e:
        msg = str(e)
        if "introuvable" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        logger.exception("Erreur finalize plaquette %s", year)
        raise HTTPException(status_code=500, detail=f"Erreur finalisation : {e}")


@router.post("/{year}/journal/{entry_id}/attachments")
async def upload_journal_attachment(
    year: int,
    entry_id: str,
    file: UploadFile = File(...),
) -> dict:
    """Upload d'une pièce jointe sur une entrée journal.

    Codes :
      - 400 : fichier vide / payload invalide
      - 404 : année ou entry_id introuvable
      - 413 : > 10 Mo
      - 415 : mime non whitelisté
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    try:
        attachment = plaquette_service.add_journal_attachment(
            year=year,
            entry_id=entry_id,
            filename=file.filename or "file",
            content_bytes=content,
            mime_type=file.content_type or "application/octet-stream",
        )
        return attachment
    except ValueError as e:
        code = str(e)
        if code == "file_too_large":
            raise HTTPException(status_code=413, detail="Fichier > 10 Mo")
        if code == "unsupported_mime":
            raise HTTPException(
                status_code=415,
                detail="Type de fichier non autorisé (PDF, PNG, JPG, WEBP, EML, ZIP uniquement)",
            )
        if code in ("plaquette_not_found", "entry_not_found"):
            raise HTTPException(status_code=404, detail=code)
        if code == "empty_file":
            raise HTTPException(status_code=400, detail="Fichier vide")
        raise HTTPException(status_code=400, detail=code)


@router.get("/{year}/journal/{entry_id}/attachments/{filename}")
def get_journal_attachment(year: int, entry_id: str, filename: str):
    """Téléchargement/preview inline d'un attachement."""
    fpath = plaquette_service.get_journal_attachment_path(year, entry_id, filename)
    if fpath is None:
        raise HTTPException(status_code=404, detail="Attachement introuvable")
    # Lookup mime depuis le JSON (préserve eml/zip)
    data = plaquette_service._load_year(year) or {}
    mime = "application/octet-stream"
    for entry in data.get("journal", []) or []:
        if entry.get("entry_id") == entry_id:
            for att in entry.get("attachments") or []:
                if att.get("filename") == filename:
                    mime = att.get("mime_type") or mime
                    break
            break
    return FileResponse(
        str(fpath),
        media_type=mime,
        filename=filename,
        content_disposition_type="inline",
    )


@router.delete("/{year}/journal/{entry_id}/attachments/{filename}")
def delete_journal_attachment(year: int, entry_id: str, filename: str) -> dict:
    """Suppression d'un attachement (JSON + disque)."""
    ok = plaquette_service.remove_journal_attachment(year, entry_id, filename)
    if not ok:
        raise HTTPException(status_code=404, detail="Attachement introuvable")
    return {"status": "deleted", "filename": filename}


# ─── Session 39 P2 : évaluation risque fiscal ───


def _guard_not_declared(year: int) -> dict:
    """Charge la plaquette et lève HTTP 423 si status==DECLARE (snapshot figé).

    Pour les endpoints qui modifient le risque (override / reset / recompute).
    Le GET /top reste autorisé en DECLARE (lecture seule).
    """
    data = plaquette_service._load_year(year)
    if data is None:
        raise HTTPException(status_code=404, detail=f"PlaquetteCheck {year} introuvable")
    if data.get("status") == PlaquetteCheckStatus.DECLARE.value:
        raise HTTPException(status_code=423, detail=f"plaquette frozen status={data.get('status')}")
    return data


@router.post("/{year}/risque/recompute")
def recompute_risque(year: int) -> dict:
    """Force le recalcul du risque de tous les items (ignore le cache `last_evaluated_at`).

    Préserve les overrides manuels. Skip 423 si status==DECLARE.
    """
    data = _guard_not_declared(year)
    plaquette_risque_service.evaluate_all_items(data, force_recompute=True)
    data["updated_at"] = plaquette_service._now_iso()
    plaquette_service._save_atomic(plaquette_service._year_file(year), data)
    nb_evaluated = sum(1 for i in data.get("items", []) if i.get("risque_fiscal"))
    return {
        "status": "recomputed",
        "year": year,
        "nb_items_evaluated": nb_evaluated,
        "risque_score_global": data.get("risque_score_global"),
    }


@router.patch("/{year}/items/{item_id}/risque")
def override_item_risque(year: int, item_id: str, payload: RisqueOverrideRequest) -> dict:
    """Override manuel du niveau de risque d'un item (motif obligatoire pour traçabilité).

    Skip 423 si status==DECLARE.
    """
    data = _guard_not_declared(year)
    if not payload.motif.strip():
        raise HTTPException(status_code=400, detail="Le motif d'override est obligatoire")
    try:
        item = plaquette_risque_service.override_item_risque(
            data, item_id, payload.niveau, payload.motif.strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # Recalcule le score global pondéré après override
    data["risque_score_global"] = plaquette_risque_service.compute_global_score(data.get("items", []))
    data["updated_at"] = plaquette_service._now_iso()
    plaquette_service._save_atomic(plaquette_service._year_file(year), data)
    return item


@router.delete("/{year}/items/{item_id}/risque/override")
def reset_item_risque(year: int, item_id: str) -> dict:
    """Repasse un item en mode auto (efface l'override). Skip 423 si DECLARE.

    Le prochain GET /{year} recalculera le niveau automatiquement.
    """
    data = _guard_not_declared(year)
    try:
        item = plaquette_risque_service.reset_item_risque_auto(data, item_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # Re-évalue immédiatement (force_recompute pour ne pas hitter le cache)
    plaquette_risque_service.evaluate_all_items(data, force_recompute=True)
    data["updated_at"] = plaquette_service._now_iso()
    plaquette_service._save_atomic(plaquette_service._year_file(year), data)
    return item


@router.get("/{year}/risque/top")
def get_top_risques(year: int, limit: int = Query(5, ge=1, le=50)) -> dict:
    """Top N items triés par niveau desc puis montant_neuronx desc.

    Autorisé en DECLARE (lecture seule de la photo figée).
    """
    data = plaquette_service.get(year)
    if data is None:
        raise HTTPException(status_code=404, detail=f"PlaquetteCheck {year} introuvable")
    top = plaquette_risque_service.get_top_risques(data, limit=limit)
    return {
        "year": year,
        "nb_items": len(top),
        "items": top,
        "risque_score_global": data.get("risque_score_global"),
    }


@router.post("/{year}/log-comptable-response")
def log_response(year: int, payload: ComptableResponseRequest) -> ComptableResponseResult:
    """Logge une réponse comptable + bascule N items en lot.

    Crée un JournalEntry `email_in` puis applique les statuts/commentaires demandés.
    Préfixe automatiquement `[YYYY-MM-DD réponse comptable]` au commentaire pour traçabilité.
    """
    try:
        return plaquette_service.log_comptable_response(year, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Erreur log-comptable-response %s", year)
        raise HTTPException(status_code=500, detail=f"Erreur : {e}")


@router.get("/{year}/reports")
def list_year_reports(year: int) -> dict:
    """Liste les PDF rapports archivés en GED pour cette année (source_module=plaquette).

    Retourne `{count, reports: [{filename, doc_id, generated_at, size_bytes, preview_url}, ...]}`
    triés par date de génération décroissante.
    """
    from pathlib import Path as _P
    from backend.services import ged_service

    metadata = ged_service.load_metadata()
    docs = metadata.get("documents", {})
    out: list[dict] = []
    for doc_id, doc in docs.items():
        if doc.get("type") != "rapport":
            continue
        rapport_meta = doc.get("rapport_meta") or {}
        if rapport_meta.get("source_module") != "plaquette":
            continue
        if rapport_meta.get("filters", {}).get("year") != year and doc.get("year") != year:
            continue
        # Récupère taille via filesystem (si fichier présent)
        try:
            size = _P(doc_id).stat().st_size if _P(doc_id).exists() else None
        except Exception:
            size = None
        out.append({
            "filename": doc.get("filename") or _P(doc_id).name,
            "doc_id": doc_id,
            "generated_at": rapport_meta.get("generated_at") or doc.get("added_at"),
            "size_bytes": size,
            "preview_url": f"/api/ged/documents/{doc_id}/preview",
        })
    # Tri par date desc
    out.sort(key=lambda r: r.get("generated_at") or "", reverse=True)
    return {"count": len(out), "reports": out}


@router.delete("/{year}/reports/{filename}")
def delete_year_report(year: int, filename: str) -> dict:
    """Supprime un rapport archivé (GED + fichier sur disque)."""
    from pathlib import Path as _P
    from backend.services import ged_service

    metadata = ged_service.load_metadata()
    docs = metadata.get("documents", {})
    target_doc_id: Optional[str] = None
    for doc_id, doc in docs.items():
        if doc.get("type") != "rapport":
            continue
        rapport_meta = doc.get("rapport_meta") or {}
        if rapport_meta.get("source_module") != "plaquette":
            continue
        if (doc.get("filename") == filename or _P(doc_id).name == filename) and (
            doc.get("year") == year
            or rapport_meta.get("filters", {}).get("year") == year
        ):
            target_doc_id = doc_id
            break
    if not target_doc_id:
        raise HTTPException(status_code=404, detail=f"Rapport {filename} introuvable pour {year}")
    ok = ged_service.delete_document(target_doc_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Erreur suppression GED")
    return {"status": "deleted", "filename": filename, "doc_id": target_doc_id}


@router.post("/{year}/generate-pdf-report")
def generate_pdf_report(year: int) -> dict:
    """Génère un PDF de rapport de vérification + enregistre en GED.

    Le PDF agrège :
      - Synthèse BNC (Plaquette vs NeuronX) + variation N-1
      - Anomalies à régulariser (statut a_challenger) avec argumentaire
      - Points méthodologiques en discussion (statut en_discussion)
      - Tableau complet par poste comptable

    Returns: {filename, ged_doc_id, size_bytes, generated_at, year}
    """
    try:
        result = plaquette_report_service.generate_and_register(year)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Erreur génération PDF plaquette %s", year)
        raise HTTPException(status_code=500, detail=f"Erreur génération : {e}")


@router.post("/{year}/prepare-email-bundle")
def prepare_email_bundle(year: int) -> dict:
    """Orchestre la préparation complète de l'envoi au comptable.

    1. Génère (ou réutilise) le PDF rapport de vérification.
    2. Construit le subject + body via generate_challenge_email.
    3. Retourne la liste des pièces jointes recommandées : [rapport_plaquette_check, plaquette_originale].

    Le frontend utilise ces données pour pré-remplir SendToAccountantDrawer.

    Returns:
        {
          subject, body, related_item_ids, nb_items,
          attachments: [{type, filename}, ...],
          rapport_filename, plaquette_doc_id
        }
    """
    try:
        # 1. Générer le rapport PDF (overwrite à chaque appel — le dernier rapport gagne)
        rapport = plaquette_report_service.generate_and_register(year)

        # 2. Récupérer subject + body
        email = plaquette_service.generate_challenge_email(year, nom="Dr Ceccoli")

        # 3. Construire la liste des attachments
        attachments: list[dict] = []
        # Rapport PDF de vérification
        attachments.append({
            "type": "rapport",
            "filename": rapport["filename"],
        })
        # Plaquette comptable originale (si liée)
        data = plaquette_service.get(year)
        if data and data.get("ged_doc_id"):
            ged_doc_id = data["ged_doc_id"]
            # basename de la plaquette
            plaquette_basename = ged_doc_id.split("/")[-1] if "/" in ged_doc_id else ged_doc_id
            attachments.append({
                "type": "ged",
                "filename": plaquette_basename,
            })

        return {
            "subject": email.subject,
            "body": email.body,
            "related_item_ids": email.related_item_ids,
            "nb_items": email.nb_items,
            "attachments": attachments,
            "rapport_filename": rapport["filename"],
            "rapport_ged_doc_id": rapport.get("ged_doc_id"),
            "rapport_size_bytes": rapport.get("size_bytes"),
            "plaquette_ged_doc_id": data.get("ged_doc_id") if data else None,
        }
    except Exception as e:
        logger.exception("Erreur prepare-email-bundle %s", year)
        raise HTTPException(status_code=500, detail=f"Erreur préparation : {e}")
