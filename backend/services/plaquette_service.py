"""Service principal pour la vérification de plaquette comptable.

Stockage : data/plaquette_check/{year}.json (1 fichier par exercice).
Workflow itératif : saisie/upload plaquette → calcul écarts NeuronX → statuts/commentaires
→ génération email de challenge → journal d'échanges.

Le module est conçu pour être trivial à brancher sur SQLite/Postgres plus tard
(structure dénormalisée par année, items immutables identifiés par item_id stable).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import PLAQUETTE_CHECK_DIR
from backend.models.plaquette_check import (
    ComptableResponseRequest,
    ComptableResponseResult,
    GenerateChallengeEmailResponse,
    JournalEntry,
    JournalEntryCreate,
    PlaquetteCheck,
    PlaquetteItem,
    PlaquetteItemCreate,
    PlaquetteItemPatch,
    PlaquetteTotauxPatch,
)
from backend.services import plaquette_pcg_mapping_service

logger = logging.getLogger(__name__)


# ─── Helpers I/O ───


def _year_file(year: int) -> Path:
    return PLAQUETTE_CHECK_DIR / f"{year}.json"


def _now_iso() -> str:
    return datetime.now().isoformat()


def _save_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(path))
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _load_year(year: int) -> Optional[dict]:
    p = _year_file(year)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Failed to load plaquette_check %s: %s", year, e)
        return None


def _stable_item_id(compte_pcg: Optional[str], rubrique: Optional[str], label: str) -> str:
    """Hash stable pour identifier un item indépendamment de l'ordre."""
    seed = f"{(compte_pcg or '').strip()}|{(rubrique or '').strip()}|{label.strip().lower()}"
    return "it_" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:10]


# ─── Bootstrap : créer un PlaquetteCheck depuis le template PCG ───


def _bootstrap_items(template: str) -> list[dict]:
    """Génère les items pré-remplis (sans montants) depuis le mapping."""
    seeds = plaquette_pcg_mapping_service.seed_items_from_template(template)
    items = []
    now = _now_iso()
    for s in seeds:
        items.append({
            "item_id": _stable_item_id(s["compte_pcg"], s["rubrique_2035"], s["compte_label"]),
            "compte_pcg": s["compte_pcg"],
            "compte_label": s["compte_label"],
            "rubrique_2035": s["rubrique_2035"],
            "montant_plaquette": None,
            "montant_plaquette_n1": None,
            "montant_neuronx": None,
            "ecart": None,
            "categories_neuronx": s["categories"],
            "sous_categories_neuronx": s["sous_categories"],
            "statut": "non_revu",
            "commentaire": "",
            "nb_ops_neuronx": 0,
            "last_modified_at": now,
        })
    return items


def _new_plaquette_check(year: int, template: str = "sygnatures_marenco") -> dict:
    now = _now_iso()
    return {
        "version": 1,
        "year": year,
        "cabinet_template": template,
        "ged_doc_id": None,
        "uploads": [],
        "items": _bootstrap_items(template),
        "journal": [],
        "totaux_plaquette": {},
        "created_at": now,
        "updated_at": now,
    }


# ─── Calcul montant_neuronx via analytics ───


def _aggregate_neuronx_for_categories(
    year: int,
    categories: list[str],
    sous_categories: list[str],
    flags: dict,
) -> tuple[float, int]:
    """Somme les débits NeuronX pour un ensemble de catégories/sous-catégories.

    Réutilise `analytics_service.get_category_detail` (par catégorie) si possible
    pour respecter l'éclatement ventilations + filtres pro/perso/attente.

    Pour les comptes spéciaux (`is_dotation`, `is_bilan`, `is_recettes`,
    `split_csg_deductible`, `split_urssaf_cotisations`), applique une logique métier
    dédiée.
    """
    if not categories:
        return 0.0, 0

    # Cas spécial : dotations aux amortissements
    if flags.get("is_dotation"):
        try:
            from backend.services import amortissement_service
            d = amortissement_service.get_dotations(year)
            return float(d.get("total_deductible", 0.0) or 0.0), len(d.get("detail", []))
        except Exception as e:
            logger.warning("get_dotations(%s) failed: %s", year, e)
            return 0.0, 0

    # Cas spécial : recettes (CA liasse)
    if flags.get("is_recettes"):
        try:
            from backend.services import liasse_scp_service
            ca = liasse_scp_service.get_ca_for_bnc(year)
            return float(ca or 0.0), 0
        except Exception:
            return 0.0, 0

    # Cas spécial : bilan immobilisation — somme des acquisitions de l'année
    if flags.get("is_bilan"):
        try:
            from backend.services import amortissement_service
            immos = amortissement_service.get_all_immobilisations()
            total = 0.0
            count = 0
            for i in immos:
                dacq = i.get("date_acquisition", "")
                if dacq.startswith(str(year)):
                    total += float(i.get("base_amortissable", 0) or 0)
                    count += 1
            return total, count
        except Exception:
            return 0.0, 0

    # Cas spécial : CSG déductible (part déductible des paiements URSSAF)
    if flags.get("split_csg_deductible"):
        # CSG déductible = URSSAF total - CSG_non_deductible
        # Bareme NeuronX 2025: csg_deductible_taux × assiette
        try:
            from backend.services import fiscal_service, operation_service
            bareme = fiscal_service.load_bareme("urssaf", year)
            taux_csg_ded = float(bareme.get("csg_crds", {}).get("taux_csg_deductible", 0.068))
            assiette_mode = bareme.get("csg_crds", {}).get("assiette_mode", "bnc_abattu")
            if assiette_mode == "bnc_abattu":
                from backend.services import bnc_service
                breakdown = bnc_service.compute_bnc(year)
                assiette = float(breakdown.bnc) * (1.0 - float(bareme.get("csg_crds", {}).get("assiette_abattement", 0.26)))
            else:
                # Fallback : approx sur BNC + cotisations
                from backend.services import bnc_service
                breakdown = bnc_service.compute_bnc(year)
                assiette = float(breakdown.bnc) * 1.25
            csg_ded = assiette * taux_csg_ded
            return round(csg_ded, 2), 0
        except Exception as e:
            logger.warning("split_csg_deductible failed: %s", e)
            return 0.0, 0

    # Cas spécial : URSSAF cotisations (URSSAF total - CSG totale)
    if flags.get("split_urssaf_cotisations"):
        try:
            from backend.services import fiscal_service, operation_service
            total_urssaf = fiscal_service._compute_total_urssaf_debit_annuel(year)
            bareme = fiscal_service.load_bareme("urssaf", year)
            csg_total_taux = float(bareme.get("csg_crds", {}).get("taux_total", 0.097))
            assiette_mode = bareme.get("csg_crds", {}).get("assiette_mode", "bnc_abattu")
            if assiette_mode == "bnc_abattu":
                from backend.services import bnc_service
                breakdown = bnc_service.compute_bnc(year)
                assiette = float(breakdown.bnc) * (1.0 - float(bareme.get("csg_crds", {}).get("assiette_abattement", 0.26)))
            else:
                from backend.services import bnc_service
                breakdown = bnc_service.compute_bnc(year)
                assiette = float(breakdown.bnc) * 1.25
            csg_total = assiette * csg_total_taux
            cotis = max(0.0, total_urssaf - csg_total)
            return round(cotis, 2), 0
        except Exception as e:
            logger.warning("split_urssaf_cotisations failed: %s", e)
            return 0.0, 0

    # Cas standard : somme via analytics_service par catégorie
    try:
        from backend.services import operation_service, analytics_service
        # Charge toutes les ops de l'année
        files = operation_service.list_operation_files()
        year_files = [f for f in files if f.get("year") == year]
        all_ops: list[dict] = []
        for finfo in year_files:
            all_ops.extend(operation_service.load_operations(finfo["filename"]))

        total_debit = 0.0
        nb_ops = 0
        for cat in categories:
            try:
                detail = analytics_service.get_category_detail(all_ops, cat)
            except Exception as e:
                logger.debug("get_category_detail(%s) failed: %s", cat, e)
                continue
            cat_debit = float(detail.get("total_debit", 0.0) or 0.0)
            cat_n = int(detail.get("nb_operations", 0) or 0)
            # Si sous-catégories restreintes → filtrer
            if sous_categories:
                sub_match = 0.0
                sub_n = 0
                for sub_info in detail.get("subcategories", []) or []:
                    if sub_info.get("name") in sous_categories or sub_info.get("sous_categorie") in sous_categories:
                        sub_match += float(sub_info.get("debit", 0.0) or 0.0)
                        sub_n += int(sub_info.get("count", 0) or 0)
                cat_debit = sub_match
                cat_n = sub_n
            total_debit += cat_debit
            nb_ops += cat_n

        # Appliquer la quote-part véhicule si flagué (réforme méthode comptable)
        if flags.get("apply_quote_part_vehicule"):
            try:
                from backend.services import fiscal_service
                bareme_v = fiscal_service.load_bareme("vehicule", year)
                ratio = float(bareme_v.get("ratio_pro_applique", 100.0)) / 100.0
                total_debit = round(total_debit * ratio, 2)
            except Exception as e:
                logger.debug("apply QP vehicule failed: %s", e)

        return round(total_debit, 2), nb_ops
    except Exception as e:
        logger.warning("aggregate failed for cats=%s: %s", categories, e)
        return 0.0, 0


def _refresh_item_neuronx(item: dict, year: int, template: str) -> None:
    """Met à jour `montant_neuronx`, `ecart`, `nb_ops_neuronx` en place."""
    cats = item.get("categories_neuronx") or []
    subs = item.get("sous_categories_neuronx") or []
    # Récupère les flags depuis le mapping (item peut être désynchronisé du template)
    _, _, flags = plaquette_pcg_mapping_service.resolve(item.get("compte_pcg"), template)
    montant, nb_ops = _aggregate_neuronx_for_categories(year, cats, subs, flags)
    item["montant_neuronx"] = montant
    item["nb_ops_neuronx"] = nb_ops
    mp = item.get("montant_plaquette")
    if mp is not None and montant is not None:
        item["ecart"] = round(montant - float(mp), 2)
    else:
        item["ecart"] = None


# ─── API publique ───


def get_or_create(year: int, template: str = "sygnatures_marenco") -> dict:
    """Récupère le PlaquetteCheck de l'année, le crée si absent. Recalcule les montants NeuronX."""
    data = _load_year(year)
    if data is None:
        data = _new_plaquette_check(year, template)
    # Recalcule montants NeuronX à la volée
    template_eff = data.get("cabinet_template") or template
    for item in data.get("items", []):
        _refresh_item_neuronx(item, year, template_eff)
    data["updated_at"] = _now_iso()
    _save_atomic(_year_file(year), data)
    return data


def get(year: int) -> Optional[dict]:
    """Récupère sans créer."""
    data = _load_year(year)
    if data is None:
        return None
    template_eff = data.get("cabinet_template") or "sygnatures_marenco"
    for item in data.get("items", []):
        _refresh_item_neuronx(item, year, template_eff)
    return data


def patch_item(year: int, item_id: str, patch: PlaquetteItemPatch) -> dict:
    """Met à jour partiellement un item. Recalcule l'écart."""
    data = _load_year(year)
    if data is None:
        raise ValueError(f"PlaquetteCheck {year} introuvable")
    items = data.get("items", [])
    for item in items:
        if item.get("item_id") != item_id:
            continue
        if patch.montant_plaquette is not None:
            item["montant_plaquette"] = float(patch.montant_plaquette)
        if patch.montant_plaquette_n1 is not None:
            item["montant_plaquette_n1"] = float(patch.montant_plaquette_n1)
        if patch.compte_pcg is not None:
            item["compte_pcg"] = patch.compte_pcg
            # Re-résoudre categories depuis le mapping si compte change
            cats, subs, _ = plaquette_pcg_mapping_service.resolve(
                patch.compte_pcg, data.get("cabinet_template", "sygnatures_marenco")
            )
            if cats:
                item["categories_neuronx"] = cats
                item["sous_categories_neuronx"] = subs
        if patch.compte_label is not None:
            item["compte_label"] = patch.compte_label
        if patch.rubrique_2035 is not None:
            item["rubrique_2035"] = patch.rubrique_2035
        if patch.statut is not None:
            item["statut"] = patch.statut
        if patch.commentaire is not None:
            item["commentaire"] = patch.commentaire
        item["last_modified_at"] = _now_iso()
        _refresh_item_neuronx(item, year, data.get("cabinet_template", "sygnatures_marenco"))
        data["updated_at"] = _now_iso()
        _save_atomic(_year_file(year), data)
        return item
    raise ValueError(f"Item {item_id} introuvable")


def add_item(year: int, payload: PlaquetteItemCreate) -> dict:
    """Ajoute un item manuel (cas saisie sans template ou rubrique custom)."""
    data = _load_year(year)
    if data is None:
        data = _new_plaquette_check(year)
    cats, subs, _ = plaquette_pcg_mapping_service.resolve(
        payload.compte_pcg, data.get("cabinet_template", "sygnatures_marenco")
    )
    new_item = {
        "item_id": _stable_item_id(payload.compte_pcg, payload.rubrique_2035, payload.compte_label),
        "compte_pcg": payload.compte_pcg,
        "compte_label": payload.compte_label,
        "rubrique_2035": payload.rubrique_2035,
        "montant_plaquette": payload.montant_plaquette,
        "montant_plaquette_n1": payload.montant_plaquette_n1,
        "montant_neuronx": None,
        "ecart": None,
        "categories_neuronx": cats,
        "sous_categories_neuronx": subs,
        "statut": "non_revu",
        "commentaire": "",
        "nb_ops_neuronx": 0,
        "last_modified_at": _now_iso(),
    }
    # Dedup si même item_id
    items = data.get("items", [])
    existing = next((i for i in items if i.get("item_id") == new_item["item_id"]), None)
    if existing:
        existing.update({k: v for k, v in new_item.items() if v is not None})
        _refresh_item_neuronx(existing, year, data.get("cabinet_template", "sygnatures_marenco"))
        target = existing
    else:
        _refresh_item_neuronx(new_item, year, data.get("cabinet_template", "sygnatures_marenco"))
        items.append(new_item)
        target = new_item
    data["items"] = items
    data["updated_at"] = _now_iso()
    _save_atomic(_year_file(year), data)
    return target


def delete_item(year: int, item_id: str) -> bool:
    """Supprime un item."""
    data = _load_year(year)
    if data is None:
        return False
    before = len(data.get("items", []))
    data["items"] = [i for i in data.get("items", []) if i.get("item_id") != item_id]
    if len(data["items"]) == before:
        return False
    data["updated_at"] = _now_iso()
    _save_atomic(_year_file(year), data)
    return True


def patch_totaux(year: int, patch: PlaquetteTotauxPatch) -> dict:
    """Met à jour les totaux (recettes/dépenses/bénéfice + N-1)."""
    data = _load_year(year)
    if data is None:
        data = _new_plaquette_check(year)
    totaux = data.get("totaux_plaquette") or {}
    for field in ("recettes", "depenses", "benefice", "recettes_n1", "depenses_n1", "benefice_n1"):
        v = getattr(patch, field, None)
        if v is not None:
            totaux[field] = float(v)
    data["totaux_plaquette"] = totaux
    data["updated_at"] = _now_iso()
    _save_atomic(_year_file(year), data)
    return totaux


def set_ged_ref(year: int, ged_doc_id: str, cabinet_template: Optional[str] = None) -> dict:
    """Lie la plaquette à un document GED existant."""
    data = _load_year(year)
    if data is None:
        data = _new_plaquette_check(year, cabinet_template or "sygnatures_marenco")
    data["ged_doc_id"] = ged_doc_id
    if cabinet_template:
        data["cabinet_template"] = cabinet_template
    data["updated_at"] = _now_iso()
    _save_atomic(_year_file(year), data)
    return data


def add_journal_entry(year: int, payload: JournalEntryCreate) -> dict:
    """Ajoute une entrée au journal."""
    data = _load_year(year)
    if data is None:
        data = _new_plaquette_check(year)
    entry = {
        "entry_id": "j_" + secrets.token_urlsafe(6),
        "timestamp": _now_iso(),
        "type": payload.type,
        "subject": payload.subject,
        "body_excerpt": payload.body_excerpt[:500],
        "related_item_ids": payload.related_item_ids,
        "ged_email_history_id": payload.ged_email_history_id,
        "author": payload.author,
    }
    data["journal"].append(entry)
    data["updated_at"] = _now_iso()
    _save_atomic(_year_file(year), data)
    return entry


def list_drill_ops(year: int, item_id: str, limit: int = 100) -> list[dict]:
    """Drill-down ops NeuronX correspondant à un item (filtrées par catégories mappées)."""
    data = _load_year(year)
    if data is None:
        return []
    item = next((i for i in data.get("items", []) if i.get("item_id") == item_id), None)
    if not item:
        return []
    cats = set(item.get("categories_neuronx") or [])
    subs = set(item.get("sous_categories_neuronx") or [])
    if not cats:
        return []

    from backend.services import operation_service
    files = operation_service.list_operation_files()
    year_files = [f for f in files if f.get("year") == year]
    out: list[dict] = []
    for finfo in year_files:
        ops = operation_service.load_operations(finfo["filename"])
        for idx, op in enumerate(ops):
            cat = (op.get("Catégorie") or "").strip()
            if cat not in cats:
                continue
            if subs:
                sub = (op.get("Sous-catégorie") or "").strip()
                if sub not in subs:
                    continue
            out.append({
                "file": finfo["filename"],
                "index": idx,
                "date": op.get("Date"),
                "libelle": op.get("Libellé") or op.get("Libelle") or "",
                "debit": float(op.get("Débit") or 0),
                "credit": float(op.get("Crédit") or 0),
                "categorie": cat,
                "sous_categorie": op.get("Sous-catégorie"),
                "justificatif": op.get("Lien justificatif") or None,
                "locked": bool(op.get("locked")),
            })
    # Tri par montant débit desc
    out.sort(key=lambda x: -x["debit"])
    return out[:limit]


# ─── Génération email de challenge ───


def _format_eur(amount: Optional[float]) -> str:
    if amount is None:
        return "—"
    sign = "-" if amount < 0 else ""
    a = abs(float(amount))
    s = f"{a:,.2f}".replace(",", " ").replace(".", ",")
    return f"{sign}{s} €"


def generate_challenge_email(year: int, nom: Optional[str] = None) -> GenerateChallengeEmailResponse:
    """Construit subject + body texte agrégeant les items en statut a_challenger."""
    data = _load_year(year)
    if data is None:
        return GenerateChallengeEmailResponse(
            subject=f"Plaquette {year} — points à challenger", body="(aucun item)", related_item_ids=[], nb_items=0
        )
    items = [i for i in data.get("items", []) if i.get("statut") == "a_challenger"]
    if not items:
        return GenerateChallengeEmailResponse(
            subject=f"Plaquette {year} — points à challenger", body="(aucun item marqué à challenger)", related_item_ids=[], nb_items=0
        )

    subject = f"Plaquette comptable {year} — {len(items)} point(s) à challenger"
    lines: list[str] = []
    lines.append(f"Bonjour,")
    lines.append("")
    lines.append(f"Après revue de la plaquette comptable de l'exercice {year}, je souhaiterais")
    lines.append(f"des précisions sur les {len(items)} point(s) suivant(s) :")
    lines.append("")

    for i, item in enumerate(items, 1):
        pcg = item.get("compte_pcg") or "—"
        label = item.get("compte_label") or "—"
        mp = _format_eur(item.get("montant_plaquette"))
        mn = _format_eur(item.get("montant_neuronx"))
        ecart = _format_eur(item.get("ecart"))
        commentaire = (item.get("commentaire") or "").strip()
        lines.append(f"{i}. Compte {pcg} — {label}")
        lines.append(f"   Plaquette : {mp}  |  NeuronX : {mn}  |  Écart : {ecart}")
        if commentaire:
            lines.append(f"   → {commentaire}")
        lines.append("")

    lines.append("Je reste à votre disposition pour vous transmettre les justificatifs détaillés.")
    lines.append("")
    lines.append("Bien cordialement,")
    lines.append("")
    lines.append(nom or "Dr Ceccoli")

    return GenerateChallengeEmailResponse(
        subject=subject,
        body="\n".join(lines),
        related_item_ids=[i.get("item_id") for i in items if i.get("item_id")],
        nb_items=len(items),
    )


def log_comptable_response(year: int, payload: ComptableResponseRequest) -> ComptableResponseResult:
    """Logge une réponse comptable + bascule N items en lot.

    1. Crée un JournalEntry de type `email_in` (réponse reçue du comptable).
    2. Pour chaque `ItemStatusUpdate`, applique `patch_item` :
       - statut → new_statut
       - commentaire ← commentaire existant + préfixe `[YYYY-MM-DD réponse comptable]` + appended_comment
    3. Retourne le résumé.
    """
    data = _load_year(year)
    if data is None:
        raise ValueError(f"PlaquetteCheck {year} introuvable")

    received_at = payload.received_at or _now_iso()
    received_date = received_at[:10]  # YYYY-MM-DD

    # 1. Création journal entry
    journal_payload = JournalEntryCreate(
        type="email_in",
        subject=payload.subject or f"Réponse plaquette {year}",
        body_excerpt=payload.body_excerpt[:500],
        related_item_ids=[u.item_id for u in payload.items_updates],
        author="comptable",
    )
    entry = add_journal_entry(year, journal_payload)

    # 2. Appliquer les updates items
    updated_ids: list[str] = []
    for upd in payload.items_updates:
        try:
            # Recharger l'item pour avoir le commentaire courant
            current = _load_year(year)
            item = next(
                (it for it in (current or {}).get("items", []) if it.get("item_id") == upd.item_id),
                None,
            )
            if not item:
                logger.warning("log_comptable_response: item %s introuvable", upd.item_id)
                continue
            old_comment = item.get("commentaire") or ""
            new_comment = old_comment
            if upd.appended_comment:
                prefix = f"\n\n[{received_date} réponse comptable] "
                new_comment = (old_comment + prefix + upd.appended_comment).strip()
            patch_item(
                year,
                upd.item_id,
                PlaquetteItemPatch(
                    statut=upd.new_statut,
                    commentaire=new_comment,
                ),
            )
            updated_ids.append(upd.item_id)
        except Exception as e:
            logger.warning("log_comptable_response: échec sur item %s : %s", upd.item_id, e)

    return ComptableResponseResult(
        journal_entry_id=entry["entry_id"],
        updated_items_count=len(updated_ids),
        updated_item_ids=updated_ids,
    )
