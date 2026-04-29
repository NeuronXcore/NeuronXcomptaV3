"""
Service Previsionnel — calendrier de tresorerie annuel.
CRUD providers, echeances, scan matching, parsing OCR, timeline.
"""
from __future__ import annotations

import json
import logging
import math
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

import numpy as np

from backend.core.config import (
    PREV_PROVIDERS_FILE,
    PREV_ECHEANCES_FILE,
    PREV_SETTINGS_FILE,
    PREVISIONNEL_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    MOIS_FR,
    ensure_directories,
)
from backend.models.previsionnel import (
    PrevProvider,
    PrevProviderCreate,
    PrevProviderUpdate,
    PrevEcheance,
    PrevPrelevement,
    PrelevementLine,
    OcrExtractionResult,
    LinkBody,
    TimelinePoste,
    TimelineMois,
    TimelineResponse,
    PrevSettings,
    PrevDashboard,
)

logger = logging.getLogger(__name__)

MOIS_FR_LOWER = [m.lower() for m in MOIS_FR]
MOIS_FR_PATTERN = (
    r"(janvier|fevrier|février|mars|avril|mai|juin|juillet|"
    r"aout|août|septembre|octobre|novembre|decembre|décembre)"
)


# ════════════════════════════════════════════════════
#  Persistence helpers
# ════════════════════════════════════════════════════


def _load_json(path, default):
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Erreur chargement {path}: {e}")
    return default


def _save_json(path, data):
    ensure_directories()
    PREVISIONNEL_DIR.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


# ════════════════════════════════════════════════════
#  CRUD Providers
# ════════════════════════════════════════════════════


def get_providers() -> list[PrevProvider]:
    data = _load_json(PREV_PROVIDERS_FILE, {"version": 1, "providers": []})
    return [PrevProvider(**p) for p in data.get("providers", [])]


def _save_providers(providers: list[PrevProvider]):
    _save_json(PREV_PROVIDERS_FILE, {
        "version": 1,
        "providers": [p.model_dump() for p in providers],
    })


def add_provider(req: PrevProviderCreate) -> PrevProvider:
    providers = get_providers()
    slug = re.sub(r"[^a-z0-9]", "-", req.fournisseur.lower().strip())[:30]
    base_id = f"{slug}-{req.periodicite}"
    pid = base_id
    existing_ids = {p.id for p in providers}
    counter = 2
    while pid in existing_ids:
        pid = f"{base_id}-{counter}"
        counter += 1

    prov = PrevProvider(
        id=pid,
        **req.model_dump(),
    )
    providers.append(prov)
    _save_providers(providers)
    return prov


def update_provider(provider_id: str, req: PrevProviderUpdate) -> Optional[PrevProvider]:
    providers = get_providers()
    for i, p in enumerate(providers):
        if p.id == provider_id:
            updates = req.model_dump(exclude_none=True)
            providers[i] = p.model_copy(update=updates)
            _save_providers(providers)
            return providers[i]
    return None


def delete_provider(provider_id: str) -> bool:
    providers = get_providers()
    original = len(providers)
    providers = [p for p in providers if p.id != provider_id]
    if len(providers) < original:
        _save_providers(providers)
        # Supprimer echeances liees
        echeances = _load_echeances()
        echeances = [e for e in echeances if e.get("provider_id") != provider_id]
        _save_echeances_raw(echeances)
        return True
    return False


# ════════════════════════════════════════════════════
#  Echeances
# ════════════════════════════════════════════════════


def _load_echeances() -> list[dict]:
    data = _load_json(PREV_ECHEANCES_FILE, {"echeances": []})
    return data.get("echeances", [])


def _save_echeances_raw(echeances: list[dict]):
    _save_json(PREV_ECHEANCES_FILE, {"echeances": echeances})


def _save_echeances(echeances: list[PrevEcheance]):
    _save_echeances_raw([e.model_dump() for e in echeances])


def _periode_label(mois: int, periodicite: str) -> str:
    if periodicite == "mensuel":
        return f"{mois:02d}"
    elif periodicite == "bimestriel":
        return f"B{(mois - 1) // 2 + 1}"
    elif periodicite == "trimestriel":
        return f"T{(mois - 1) // 3 + 1}"
    elif periodicite == "semestriel":
        return f"S{1 if mois <= 6 else 2}"
    elif periodicite == "annuel":
        return "AN"
    return f"{mois:02d}"


def refresh_echeances(year: int) -> dict:
    """Genere les echeances pour l'annee. Ne pas ecraser les existantes."""
    providers = get_providers()
    existing = _load_echeances()
    existing_ids = {e.get("id") for e in existing}
    created = 0

    for prov in providers:
        if not prov.actif:
            continue

        if prov.mode == "echeancier":
            ech_id = f"{prov.id}-{year}"
            if ech_id not in existing_ids:
                ech = PrevEcheance(
                    id=ech_id,
                    provider_id=prov.id,
                    periode_label=f"Annuel {year}",
                    date_attendue=f"{year}-01-{prov.jour_attendu:02d}",
                    statut="attendu",
                )
                existing.append(ech.model_dump())
                created += 1
        else:
            for mois in prov.mois_attendus:
                pl = _periode_label(mois, prov.periodicite)
                ech_id = f"{prov.id}-{year}-{pl}"
                if ech_id not in existing_ids:
                    jour = min(prov.jour_attendu, 28)
                    ech = PrevEcheance(
                        id=ech_id,
                        provider_id=prov.id,
                        periode_label=f"{MOIS_FR[mois - 1]} {year}",
                        date_attendue=f"{year}-{mois:02d}-{jour:02d}",
                        statut="attendu",
                    )
                    existing.append(ech.model_dump())
                    created += 1

    _save_echeances_raw(existing)
    update_statuts_retard()
    return {"created": created, "total": len(existing)}


def update_statuts_retard():
    """Passe les echeances attendu -> en_retard si delai depasse."""
    providers = {p.id: p for p in get_providers()}
    echeances = _load_echeances()
    today = date.today()
    updated = 0

    for e in echeances:
        if e.get("statut") != "attendu":
            continue
        prov = providers.get(e.get("provider_id", ""))
        if not prov:
            continue
        try:
            d = datetime.strptime(e["date_attendue"], "%Y-%m-%d").date()
            if d + timedelta(days=prov.delai_retard_jours) < today:
                e["statut"] = "en_retard"
                updated += 1
        except (ValueError, KeyError):
            pass

    if updated:
        _save_echeances_raw(echeances)


def get_echeances(year: Optional[int] = None, statut: Optional[str] = None) -> list[PrevEcheance]:
    echeances = _load_echeances()
    result = []
    for e in echeances:
        if year and not e.get("id", "").endswith(f"-{year}") and f"-{year}-" not in e.get("id", ""):
            # Check year in date_attendue
            if not e.get("date_attendue", "").startswith(str(year)):
                continue
        if statut and e.get("statut") != statut:
            continue
        result.append(PrevEcheance(**e))
    return result


def link_echeance(echeance_id: str, body: LinkBody) -> Optional[PrevEcheance]:
    echeances = _load_echeances()
    for e in echeances:
        if e.get("id") == echeance_id:
            e["statut"] = "recu"
            e["document_ref"] = body.document_ref
            e["document_source"] = body.document_source
            e["date_reception"] = datetime.now().isoformat()
            if body.montant_reel is not None:
                e["montant_reel"] = body.montant_reel
            _save_echeances_raw(echeances)
            # Chainage mode echeancier
            providers = {p.id: p for p in get_providers()}
            prov = providers.get(e.get("provider_id", ""))
            if prov and prov.mode == "echeancier":
                try:
                    auto_populate_from_ocr(echeance_id)
                except Exception as ex:
                    logger.warning(f"Auto-populate OCR failed for {echeance_id}: {ex}")
            return PrevEcheance(**e)
    return None


def unlink_echeance(echeance_id: str) -> Optional[PrevEcheance]:
    echeances = _load_echeances()
    for e in echeances:
        if e.get("id") == echeance_id:
            e["statut"] = "attendu"
            e["document_ref"] = None
            e["document_source"] = None
            e["date_reception"] = None
            e["montant_reel"] = None
            e["match_score"] = None
            e["match_auto"] = False
            _save_echeances_raw(echeances)
            return PrevEcheance(**e)
    return None


def dismiss_echeance(echeance_id: str, note: str = "") -> Optional[PrevEcheance]:
    echeances = _load_echeances()
    for e in echeances:
        if e.get("id") == echeance_id:
            e["statut"] = "non_applicable"
            e["note"] = note
            _save_echeances_raw(echeances)
            return PrevEcheance(**e)
    return None


def get_dashboard(year: int) -> PrevDashboard:
    echeances = get_echeances(year)
    recues = sum(1 for e in echeances if e.statut == "recu")
    en_attente = sum(1 for e in echeances if e.statut == "attendu")
    en_retard = sum(1 for e in echeances if e.statut == "en_retard")
    non_app = sum(1 for e in echeances if e.statut == "non_applicable")

    providers = {p.id: p for p in get_providers()}
    montant_estime = sum(providers.get(e.provider_id, PrevProvider(id="", fournisseur="", label="", periodicite="mensuel", mois_attendus=[], jour_attendu=15, delai_retard_jours=15)).montant_estime or 0 for e in echeances)
    montant_reel = sum(e.montant_reel or 0 for e in echeances if e.montant_reel)

    total_prev = sum(e.nb_prelevements_total for e in echeances)
    verif_prev = sum(e.nb_prelevements_verifies for e in echeances)
    ecart_prev = sum(1 for e in echeances for p in e.prelevements if p.statut == "ecart")

    return PrevDashboard(
        total_echeances=len(echeances),
        recues=recues,
        en_attente=en_attente,
        en_retard=en_retard,
        non_applicable=non_app,
        taux_completion=round(recues / max(len(echeances), 1), 4),
        montant_total_estime=montant_estime,
        montant_total_reel=montant_reel,
        prelevements_verifies=verif_prev,
        prelevements_total=total_prev,
        prelevements_en_ecart=ecart_prev,
        taux_prelevements=round(verif_prev / max(total_prev, 1), 4),
    )


# ════════════════════════════════════════════════════
#  Scan documents (OCR/GED → echeances)
# ════════════════════════════════════════════════════


def scan_matching() -> dict:
    """Parcourt les documents OCR + GED, matche vs echeances attendu/en_retard."""
    echeances = _load_echeances()
    providers = {p.id: p for p in get_providers()}
    pending = [e for e in echeances if e.get("statut") in ("attendu", "en_retard")]
    if not pending:
        return {"scanned": 0, "matched": 0}

    # Collecter les documents OCR
    documents = []
    for d in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        if not d.exists():
            continue
        for ocr_file in d.glob("*.ocr.json"):
            try:
                with open(ocr_file, "r", encoding="utf-8") as f:
                    ocr_data = json.load(f)
                documents.append({
                    "filename": ocr_file.stem,  # sans .ocr.json
                    "source": "justificatif",
                    "ocr": ocr_data,
                })
            except Exception:
                pass

    # Scanner GED
    try:
        from backend.services import ged_service
        ged_meta = ged_service.load_metadata()
        for doc_id, doc in ged_meta.get("documents", {}).items():
            documents.append({
                "filename": doc_id,
                "source": "ged",
                "ocr": doc,
            })
    except Exception:
        pass

    matched = 0
    for ech in pending:
        prov = providers.get(ech.get("provider_id", ""))
        if not prov or not prov.keywords_ocr:
            continue

        best_score = 0.0
        best_doc = None
        best_count = 0

        for doc in documents:
            score = _score_document_vs_echeance(doc, ech, prov)
            if score > best_score:
                best_score = score
                best_doc = doc
                best_count = 1
            elif score == best_score and score > 0:
                best_count += 1

        if best_score >= 0.75 and best_count == 1 and best_doc:
            ech["statut"] = "recu"
            ech["document_ref"] = best_doc["filename"]
            ech["document_source"] = best_doc["source"]
            ech["match_score"] = round(best_score, 4)
            ech["match_auto"] = True
            ech["date_reception"] = datetime.now().isoformat()
            matched += 1

            # Chainage echeancier
            if prov.mode == "echeancier":
                _save_echeances_raw(echeances)
                try:
                    auto_populate_from_ocr(ech["id"])
                except Exception:
                    pass
                echeances = _load_echeances()

    _save_echeances_raw(echeances)
    return {"scanned": len(documents), "matched": matched}


def _score_document_vs_echeance(doc: dict, ech: dict, prov: PrevProvider) -> float:
    """Score un document vs une echeance. 50% keywords, 30% date, 20% montant."""
    ocr = doc.get("ocr", {})
    extracted = ocr.get("extracted_data", ocr)

    # Keywords score
    raw_text = (ocr.get("raw_text", "") or "").lower()
    supplier = (extracted.get("supplier", "") or "").lower()
    text = f"{raw_text} {supplier}"
    kw_matches = sum(1 for kw in prov.keywords_ocr if kw.lower() in text)
    s_kw = min(kw_matches / max(len(prov.keywords_ocr), 1), 1.0)

    # Date score
    best_date = extracted.get("best_date", "")
    try:
        doc_date = datetime.strptime(best_date, "%Y-%m-%d").date()
        ech_date = datetime.strptime(ech["date_attendue"], "%Y-%m-%d").date()
        diff = abs((doc_date - ech_date).days)
        s_date = 1.0 if diff <= 5 else 0.8 if diff <= 15 else 0.5 if diff <= 30 else 0.2 if diff <= 60 else 0.0
    except (ValueError, KeyError):
        s_date = 0.0

    # Montant score
    best_amount = extracted.get("best_amount")
    if best_amount and prov.montant_estime:
        try:
            diff_m = abs(float(best_amount) - prov.montant_estime)
            ratio = diff_m / max(prov.montant_estime, 0.01)
            s_montant = 1.0 if ratio < 0.01 else 0.8 if ratio < 0.05 else 0.5 if ratio < 0.1 else 0.2 if ratio < 0.2 else 0.0
        except (ValueError, TypeError):
            s_montant = 0.0
    else:
        s_montant = 0.3  # pas de montant = neutre

    return s_kw * 0.5 + s_date * 0.3 + s_montant * 0.2


def check_single_document(filename: str, source: str):
    """Version ciblee post-OCR — verifie un seul document."""
    echeances = _load_echeances()
    providers = {p.id: p for p in get_providers()}
    pending = [e for e in echeances if e.get("statut") in ("attendu", "en_retard")]
    if not pending:
        return

    # Charger OCR du document
    ocr_data = {}
    for d in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        ocr_path = d / f"{filename}.ocr.json"
        if not ocr_path.exists():
            ocr_path = d / filename
            ocr_path = ocr_path.with_suffix(".ocr.json")
        if ocr_path.exists():
            try:
                with open(ocr_path, "r", encoding="utf-8") as f:
                    ocr_data = json.load(f)
            except Exception:
                pass
            break

    if not ocr_data:
        return

    doc = {"filename": filename, "source": source, "ocr": ocr_data}

    for ech in pending:
        prov = providers.get(ech.get("provider_id", ""))
        if not prov or not prov.keywords_ocr:
            continue
        score = _score_document_vs_echeance(doc, ech, prov)
        if score >= 0.75:
            ech["statut"] = "recu"
            ech["document_ref"] = filename
            ech["document_source"] = source
            ech["match_score"] = round(score, 4)
            ech["match_auto"] = True
            ech["date_reception"] = datetime.now().isoformat()
            _save_echeances_raw(echeances)
            if prov.mode == "echeancier":
                try:
                    auto_populate_from_ocr(ech["id"])
                except Exception:
                    pass
            return


# ════════════════════════════════════════════════════
#  Parsing OCR echeancier
# ════════════════════════════════════════════════════


def parse_echeancier_ocr(ocr_text: str, provider: PrevProvider, year: int) -> OcrExtractionResult:
    """Parse le texte OCR d'un document echeancier pour extraire les lignes mensuelles."""
    if not ocr_text:
        return OcrExtractionResult(success=False, nb_lignes_extraites=0, lignes=[], warnings=["Texte OCR vide"])

    lignes_extraites: dict[int, PrelevementLine] = {}
    text_lower = ocr_text.lower()

    for line in ocr_text.split("\n"):
        line_lower = line.lower().strip()
        if not line_lower:
            continue

        mois = None
        confidence = 0.5

        # Format 1 & 2: mois texte
        m_mois = re.search(MOIS_FR_PATTERN, line_lower)
        if m_mois:
            mois_txt = m_mois.group(1)
            mois_txt = mois_txt.replace("é", "e").replace("û", "u").replace("è", "e")
            mois_map = {
                "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4,
                "mai": 5, "juin": 6, "juillet": 7, "aout": 8,
                "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
            }
            mois = mois_map.get(mois_txt)
            confidence = 1.0

        # Format 3: mois numerique (MM/YYYY ou MM-YYYY)
        if mois is None:
            m_num = re.search(r"(\d{2})[/-](?:\d{2}[/-])?(\d{4})", line_lower)
            if m_num:
                m_val = int(m_num.group(1))
                y_val = int(m_num.group(2))
                if 1 <= m_val <= 12 and y_val == year:
                    mois = m_val
                    confidence = 0.7

        if mois is None:
            continue

        # Extraire montant
        m_amount = re.findall(r"(\d[\d\s]*\d),(\d{2})", line)
        if not m_amount:
            m_amount = re.findall(r"(\d+),(\d{2})", line)
        if not m_amount:
            continue

        # Prendre le dernier montant (le plus a droite)
        int_part, dec_part = m_amount[-1]
        montant = float(int_part.replace(" ", "").replace("\u00a0", "") + "." + dec_part)

        # Extraire jour optionnel
        jour = None
        m_jour = re.search(r"(\d{2})/(\d{2})/\d{4}", line)
        if m_jour:
            jour = int(m_jour.group(1))

        if mois not in lignes_extraites or confidence > (lignes_extraites[mois].ocr_confidence or 0):
            lignes_extraites[mois] = PrelevementLine(
                mois=mois,
                montant=montant,
                jour=jour,
                ocr_confidence=confidence,
            )

    lignes = sorted(lignes_extraites.values(), key=lambda l: l.mois)
    warnings = []
    for m in range(1, 13):
        if m not in lignes_extraites:
            warnings.append(f"Mois {MOIS_FR[m - 1]} non trouvé")

    return OcrExtractionResult(
        success=len(lignes) >= 6,
        nb_lignes_extraites=len(lignes),
        lignes=lignes,
        raw_text_snippet=ocr_text[:200],
        warnings=warnings,
    )


def auto_populate_from_ocr(echeance_id: str) -> Optional[OcrExtractionResult]:
    """Charge le texte OCR du document lie et parse les prelevements."""
    echeances = _load_echeances()
    ech = None
    for e in echeances:
        if e.get("id") == echeance_id:
            ech = e
            break
    if not ech or not ech.get("document_ref"):
        return None

    providers = {p.id: p for p in get_providers()}
    prov = providers.get(ech.get("provider_id", ""))
    if not prov:
        return None

    # Charger texte OCR
    ocr_text = ""
    doc_ref = ech["document_ref"]
    for d in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        ocr_path = d / f"{doc_ref}.ocr.json"
        if not ocr_path.exists():
            p = d / doc_ref
            ocr_path = p.with_suffix(".ocr.json")
        if ocr_path.exists():
            try:
                with open(ocr_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                ocr_text = data.get("raw_text", "")
            except Exception:
                pass
            break

    if not ocr_text:
        return OcrExtractionResult(success=False, nb_lignes_extraites=0, lignes=[], warnings=["Texte OCR non trouvé"])

    year = int(ech.get("date_attendue", "2026")[:4])
    result = parse_echeancier_ocr(ocr_text, prov, year)

    if result.success:
        set_prelevements(echeance_id, result.lignes, source="ocr")
        # Scan operations apres peuplement
        try:
            scan_prelevements(echeance_id)
        except Exception:
            pass

    # Stocker le resultat OCR
    for e in echeances:
        if e.get("id") == echeance_id:
            e["ocr_extraction"] = result.model_dump()
            break
    _save_echeances_raw(echeances)
    return result


# ════════════════════════════════════════════════════
#  Prelevements (mode echeancier)
# ════════════════════════════════════════════════════


def set_prelevements(echeance_id: str, lignes: list[PrelevementLine], source: str = "manuel"):
    """Cree/MAJ les prelevements mensuels. Ne pas ecraser les deja verifies."""
    echeances = _load_echeances()
    providers = {p.id: p for p in get_providers()}

    for e in echeances:
        if e.get("id") != echeance_id:
            continue
        prov = providers.get(e.get("provider_id", ""))
        if not prov:
            break

        existing = {p.get("mois"): p for p in e.get("prelevements", [])}
        year = int(e.get("date_attendue", "2026")[:4])
        new_prevs = []

        for l in lignes:
            ex = existing.get(l.mois)
            if ex and ex.get("statut") in ("verifie", "ecart", "manuel"):
                new_prevs.append(ex)
                continue

            jour = l.jour or prov.jour_attendu
            new_prevs.append(PrevPrelevement(
                mois=l.mois,
                mois_label=MOIS_FR[l.mois - 1] if 1 <= l.mois <= 12 else f"M{l.mois}",
                montant_attendu=l.montant,
                date_prevue=f"{year}-{l.mois:02d}-{min(jour, 28):02d}",
                statut="attendu",
                source=source,
                ocr_confidence=l.ocr_confidence,
            ).model_dump())

        e["prelevements"] = new_prevs
        e["nb_prelevements_total"] = len(new_prevs)
        e["nb_prelevements_verifies"] = sum(1 for p in new_prevs if p.get("statut") in ("verifie", "ecart", "manuel"))
        break

    _save_echeances_raw(echeances)


def scan_prelevements(echeance_id: str) -> dict:
    """Pour chaque prelevement attendu, chercher dans les operations bancaires."""
    from backend.services.operation_service import list_operation_files, load_operations

    echeances = _load_echeances()
    providers = {p.id: p for p in get_providers()}

    for e in echeances:
        if e.get("id") != echeance_id:
            continue
        prov = providers.get(e.get("provider_id", ""))
        if not prov:
            return {"scanned": 0, "matched": 0, "ecarts": 0}

        # Charger toutes les operations
        op_files = list_operation_files()
        year = int(e.get("date_attendue", "2026")[:4])

        matched = 0
        ecarts = 0

        for prev in e.get("prelevements", []):
            if prev.get("statut") in ("verifie", "ecart", "manuel"):
                continue

            mois = prev.get("mois")
            montant_attendu = prev.get("montant_attendu", 0)

            for of in op_files:
                if of.get("year") != year or of.get("month") != mois:
                    continue
                try:
                    ops = load_operations(of["filename"])
                except Exception:
                    continue

                for idx, op in enumerate(ops):
                    debit = op.get("Débit") or op.get("Debit") or 0
                    try:
                        debit = float(debit) if debit else 0
                    except (ValueError, TypeError):
                        debit = 0

                    if debit <= 0:
                        continue

                    libelle = (op.get("Libellé") or op.get("Libelle") or "").lower()
                    kw_match = any(kw.lower() in libelle for kw in prov.keywords_operations)
                    if not kw_match:
                        continue

                    if abs(debit - montant_attendu) <= prov.tolerance_montant:
                        ecart_val = round(debit - montant_attendu, 2)
                        prev["statut"] = "verifie" if ecart_val == 0 else "ecart"
                        prev["montant_reel"] = debit
                        prev["ecart"] = ecart_val
                        prev["operation_file"] = of["filename"]
                        prev["operation_index"] = idx
                        prev["operation_libelle"] = op.get("Libellé") or op.get("Libelle") or ""
                        prev["operation_date"] = op.get("Date", "")
                        prev["match_auto"] = True
                        matched += 1
                        if ecart_val != 0:
                            ecarts += 1
                        break
                if prev.get("statut") != "attendu":
                    break

        # Update counts
        e["nb_prelevements_verifies"] = sum(1 for p in e.get("prelevements", []) if p.get("statut") in ("verifie", "ecart", "manuel"))
        break

    _save_echeances_raw(echeances)
    return {"scanned": len(e.get("prelevements", [])), "matched": matched, "ecarts": ecarts}


def scan_all_prelevements(year: int) -> dict:
    """Scan prelevements pour toutes les echeances mode echeancier."""
    echeances = get_echeances(year)
    providers = {p.id: p for p in get_providers()}
    total_matched = 0
    total_ecarts = 0

    for ech in echeances:
        prov = providers.get(ech.provider_id)
        if prov and prov.mode == "echeancier" and ech.prelevements:
            r = scan_prelevements(ech.id)
            total_matched += r.get("matched", 0)
            total_ecarts += r.get("ecarts", 0)

    return {"matched": total_matched, "ecarts": total_ecarts}


def verify_prelevement(echeance_id: str, mois: int, operation_file: Optional[str] = None, operation_index: Optional[int] = None, montant_reel: Optional[float] = None):
    echeances = _load_echeances()
    for e in echeances:
        if e.get("id") != echeance_id:
            continue
        for p in e.get("prelevements", []):
            if p.get("mois") == mois:
                p["statut"] = "manuel"
                if montant_reel is not None:
                    p["montant_reel"] = montant_reel
                    p["ecart"] = round(montant_reel - p.get("montant_attendu", 0), 2)
                if operation_file:
                    p["operation_file"] = operation_file
                if operation_index is not None:
                    p["operation_index"] = operation_index
                break
        e["nb_prelevements_verifies"] = sum(1 for p in e.get("prelevements", []) if p.get("statut") in ("verifie", "ecart", "manuel"))
        break
    _save_echeances_raw(echeances)


def unverify_prelevement(echeance_id: str, mois: int):
    echeances = _load_echeances()
    for e in echeances:
        if e.get("id") != echeance_id:
            continue
        for p in e.get("prelevements", []):
            if p.get("mois") == mois:
                p["statut"] = "attendu"
                p["montant_reel"] = None
                p["ecart"] = None
                p["operation_file"] = None
                p["operation_index"] = None
                p["operation_libelle"] = None
                p["operation_date"] = None
                p["match_auto"] = False
                break
        e["nb_prelevements_verifies"] = sum(1 for p in e.get("prelevements", []) if p.get("statut") in ("verifie", "ecart", "manuel"))
        break
    _save_echeances_raw(echeances)


# ════════════════════════════════════════════════════
#  Timeline (calcul principal)
# ════════════════════════════════════════════════════


def get_timeline(year: int) -> TimelineResponse:
    """Construit la vue timeline 12 mois."""
    from backend.services.operation_service import list_operation_files, load_operations
    from backend.services import urssaf_provisional_service

    settings = get_settings()
    providers = get_providers()
    echeances = get_echeances(year)
    today = date.today()
    current_month = today.month if today.year == year else (13 if today.year > year else 0)

    # Calculs URSSAF dérivés (lazy : seulement si au moins un provider URSSAF typé)
    urssaf_acompte_mensuel: Optional[float] = None
    urssaf_regul_n_moins_1: Optional[float] = None
    if any(p.type_cotisation in ("urssaf_acompte", "urssaf_regul") for p in providers):
        try:
            ac = urssaf_provisional_service.compute_acompte_theorique(year)
            urssaf_acompte_mensuel = ac.get("mensuel") or None
        except Exception:
            pass
        try:
            rg = urssaf_provisional_service.compute_urssaf_regul_estimate(year - 1)
            ec = rg.get("ecart_regul", 0.0)
            urssaf_regul_n_moins_1 = ec if ec > 0 else None
        except Exception:
            pass

    # Charger operations annee N et N-1
    ops_by_month: dict[int, list[dict]] = defaultdict(list)
    ops_by_month_prev: dict[int, list[dict]] = defaultdict(list)
    op_files = list_operation_files()

    for of in op_files:
        if of.get("year") == year:
            try:
                ops = load_operations(of["filename"])
                ops_by_month[of["month"]].extend(ops)
            except Exception:
                pass
        elif of.get("year") == year - 1:
            try:
                ops = load_operations(of["filename"])
                ops_by_month_prev[of["month"]].extend(ops)
            except Exception:
                pass

    # Aggreger par categorie x mois (N-1)
    cat_month_prev = _aggregate_by_cat_month(ops_by_month_prev)
    cat_month_curr = _aggregate_by_cat_month(ops_by_month)

    # Determiner categories recettes
    categories_recettes = settings.categories_recettes
    if not categories_recettes:
        categories_recettes = _detect_recettes_categories(cat_month_prev, cat_month_curr)

    # Projections recettes (regression + saisonnalite)
    recettes_proj = _project_recettes(year, categories_recettes, op_files, settings)

    # Construire les 12 mois
    mois_list = []
    solde_cumule = 0.0
    prov_map = {p.id: p for p in providers}
    ech_by_provider_month: dict[str, dict[int, PrevEcheance]] = defaultdict(dict)
    for ech in echeances:
        try:
            m = int(ech.date_attendue[5:7])
            ech_by_provider_month[ech.provider_id][m] = ech
        except (ValueError, IndexError):
            pass

    for m in range(1, 13):
        statut_mois = "clos" if m < current_month else ("en_cours" if m == current_month else "futur")
        has_data = m in ops_by_month

        charges = []
        recettes = []

        # Charges providers
        for prov in providers:
            if not prov.actif:
                continue

            if prov.mode == "echeancier":
                # Chercher le prelevement du mois
                for ech in echeances:
                    if ech.provider_id != prov.id:
                        continue
                    for prev in ech.prelevements:
                        if prev.mois == m:
                            charges.append(TimelinePoste(
                                id=f"provider:{prov.id}:{m}",
                                label=prov.label,
                                montant=prev.montant_reel if prev.montant_reel else prev.montant_attendu,
                                source="provider",
                                statut=prev.statut,
                                provider_id=prov.id,
                            ))
                            break
            else:
                # URSSAF acompte : 12 mois, montant pris du calcul théorique BNC N-2
                if prov.type_cotisation == "urssaf_acompte":
                    ech = ech_by_provider_month.get(prov.id, {}).get(m)
                    if ech and ech.montant_reel:
                        montant = ech.montant_reel
                    elif urssaf_acompte_mensuel is not None:
                        montant = urssaf_acompte_mensuel
                    else:
                        montant = prov.montant_estime or 0
                    statut = ech.statut if ech else "attendu"
                    charges.append(TimelinePoste(
                        id=f"provider:{prov.id}:{m}",
                        label=prov.label,
                        montant=montant,
                        source="provider",
                        statut=statut,
                        provider_id=prov.id,
                        document_ref=ech.document_ref if ech else None,
                        type_cotisation="urssaf_acompte",
                    ))
                # URSSAF régul : une seule échéance en novembre N (régul de N-1)
                elif prov.type_cotisation == "urssaf_regul":
                    if m == 11 and urssaf_regul_n_moins_1 is not None:
                        ech = ech_by_provider_month.get(prov.id, {}).get(m)
                        montant = (ech.montant_reel if ech and ech.montant_reel else urssaf_regul_n_moins_1) or 0
                        statut = ech.statut if ech else "attendu"
                        charges.append(TimelinePoste(
                            id=f"provider:{prov.id}:{m}",
                            label=f"{prov.label} (régul {year - 1})",
                            montant=montant,
                            source="provider",
                            statut=statut,
                            provider_id=prov.id,
                            document_ref=ech.document_ref if ech else None,
                            type_cotisation="urssaf_regul",
                        ))
                elif m in prov.mois_attendus:
                    ech = ech_by_provider_month.get(prov.id, {}).get(m)
                    montant = (ech.montant_reel if ech and ech.montant_reel else prov.montant_estime) or 0
                    statut = ech.statut if ech else "attendu"
                    charges.append(TimelinePoste(
                        id=f"provider:{prov.id}:{m}",
                        label=prov.label,
                        montant=montant,
                        source="provider",
                        statut=statut,
                        provider_id=prov.id,
                        document_ref=ech.document_ref if ech else None,
                    ))

        # Charges categories N-1 (au-dessus du seuil)
        for cat, months_data in cat_month_prev.items():
            if cat in settings.categories_exclues or cat in categories_recettes:
                continue
            avg = sum(months_data.values()) / max(len(months_data), 1)
            if avg < settings.seuil_montant:
                continue

            if statut_mois == "clos" and has_data:
                real_amount = cat_month_curr.get(cat, {}).get(m, 0)
                if real_amount > 0:
                    charges.append(TimelinePoste(
                        id=f"cat:{cat}:{m}",
                        label=cat,
                        montant=real_amount,
                        source="realise",
                        statut="realise",
                    ))
            else:
                est = months_data.get(m, avg)
                override_key = f"charges-{m}"
                if override_key in settings.overrides_mensuels:
                    est = settings.overrides_mensuels[override_key]
                    src = "override"
                else:
                    src = "moyenne_n1"
                charges.append(TimelinePoste(
                    id=f"cat:{cat}:{m}",
                    label=cat,
                    montant=round(est, 2),
                    source=src,
                    statut="estime",
                ))

        # Recettes
        for cat in categories_recettes:
            override_key = f"recettes-{m}"
            if override_key in settings.overrides_mensuels:
                recettes.append(TimelinePoste(
                    id=f"rec:{cat}:{m}",
                    label=cat,
                    montant=settings.overrides_mensuels[override_key],
                    source="override",
                    statut="projete",
                ))
            elif statut_mois == "clos" and has_data:
                real = cat_month_curr.get(cat, {}).get(m, 0)
                if real > 0:
                    recettes.append(TimelinePoste(
                        id=f"rec:{cat}:{m}",
                        label=cat,
                        montant=real,
                        source="realise",
                        statut="realise",
                    ))
            else:
                proj = recettes_proj.get(cat, {}).get(m, 0)
                if proj > 0:
                    recettes.append(TimelinePoste(
                        id=f"rec:{cat}:{m}",
                        label=cat,
                        montant=round(proj, 2),
                        source="projete",
                        statut="projete",
                        confidence=recettes_proj.get(f"_r2_{cat}"),
                    ))

        charges_total = round(sum(p.montant for p in charges), 2)
        recettes_total = round(sum(p.montant for p in recettes), 2)
        solde = round(recettes_total - charges_total, 2)
        solde_cumule = round(solde_cumule + solde, 2)

        mois_list.append(TimelineMois(
            mois=m,
            label=MOIS_FR[m - 1],
            statut_mois=statut_mois,
            charges=charges,
            charges_total=charges_total,
            recettes=recettes,
            recettes_total=recettes_total,
            solde=solde,
            solde_cumule=solde_cumule,
        ))

    # KPIs
    charges_ann = round(sum(mo.charges_total for mo in mois_list), 2)
    recettes_ann = round(sum(mo.recettes_total for mo in mois_list), 2)

    # Taux verification = echeances recues / total echeances providers
    total_ech = len(echeances)
    verif_ech = sum(1 for e in echeances if e.statut in ("recu", "non_applicable"))

    return TimelineResponse(
        year=year,
        mois=mois_list,
        charges_annuelles=charges_ann,
        recettes_annuelles=recettes_ann,
        solde_annuel=round(recettes_ann - charges_ann, 2),
        taux_verification=round(verif_ech / max(total_ech, 1), 4),
    )


def _aggregate_by_cat_month(ops_by_month: dict[int, list[dict]]) -> dict[str, dict[int, float]]:
    """Agrege les debits par categorie x mois."""
    result: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for m, ops in ops_by_month.items():
        for op in ops:
            cat = op.get("Catégorie") or op.get("Categorie") or "Non catégorisé"
            debit = op.get("Débit") or op.get("Debit") or 0
            credit = op.get("Crédit") or op.get("Credit") or 0
            try:
                debit = float(debit) if debit else 0
                credit = float(credit) if credit else 0
            except (ValueError, TypeError):
                debit = 0
                credit = 0
            if debit > 0:
                result[cat][m] += debit
            if credit > 0:
                result[cat][m] += credit  # recettes comme positif
    return dict(result)


def _detect_recettes_categories(cat_prev: dict, cat_curr: dict) -> list[str]:
    """Auto-detection : categories ou credit > debit historiquement."""
    from backend.services.operation_service import list_operation_files, load_operations
    cat_totals: dict[str, dict[str, float]] = defaultdict(lambda: {"debit": 0, "credit": 0})

    for of in list_operation_files():
        try:
            ops = load_operations(of["filename"])
            for op in ops:
                cat = op.get("Catégorie") or op.get("Categorie") or ""
                d = op.get("Débit") or op.get("Debit") or 0
                c = op.get("Crédit") or op.get("Credit") or 0
                try:
                    cat_totals[cat]["debit"] += float(d) if d else 0
                    cat_totals[cat]["credit"] += float(c) if c else 0
                except (ValueError, TypeError):
                    pass
        except Exception:
            pass

    return [cat for cat, t in cat_totals.items() if t["credit"] > t["debit"] and cat]


def _project_recettes(year: int, categories_recettes: list[str], op_files: list[dict], settings: PrevSettings) -> dict:
    """Projette les recettes via regression lineaire + saisonnalite."""
    from backend.services.operation_service import load_operations

    # Charger donnees historiques
    ref_years = settings.annees_reference if settings.annees_reference else list({of.get("year") for of in op_files if of.get("year") and of["year"] < year})
    if not ref_years:
        return {}

    monthly_data: dict[str, list[tuple[int, float]]] = defaultdict(list)  # cat -> [(mois_absolu, montant)]
    for of in op_files:
        if of.get("year") not in ref_years:
            continue
        try:
            ops = load_operations(of["filename"])
        except Exception:
            continue
        for op in ops:
            cat = op.get("Catégorie") or op.get("Categorie") or ""
            if cat not in categories_recettes:
                continue
            credit = op.get("Crédit") or op.get("Credit") or 0
            try:
                credit = float(credit) if credit else 0
            except (ValueError, TypeError):
                credit = 0
            if credit > 0:
                mois_abs = (of["year"] - min(ref_years)) * 12 + of.get("month", 1)
                monthly_data[cat].append((mois_abs, credit))

    result: dict = {}
    for cat in categories_recettes:
        data = monthly_data.get(cat, [])
        if len(data) < 3:
            # Pas assez de donnees, utiliser moyenne simple
            avg = sum(d[1] for d in data) / max(len(data), 1) if data else 0
            result[cat] = {m: avg for m in range(1, 13)}
            result[f"_r2_{cat}"] = 0.3
            continue

        # Agreger par mois_absolu
        monthly_agg: dict[int, float] = defaultdict(float)
        for mabs, val in data:
            monthly_agg[mabs] += val

        x = np.array(list(monthly_agg.keys()), dtype=float)
        y = np.array(list(monthly_agg.values()), dtype=float)

        # Regression lineaire
        if len(x) >= 2:
            slope, intercept = np.polyfit(x, y, 1)
            y_pred = slope * x + intercept
            ss_res = np.sum((y - y_pred) ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            r2 = max(0, min(1, 1 - ss_res / max(ss_tot, 0.001)))
        else:
            slope, intercept = 0, float(np.mean(y))
            r2 = 0.3

        # Coefficients saisonniers
        avg_global = float(np.mean(y)) if len(y) > 0 else 1
        seasonal: dict[int, float] = {}
        for mabs, val in monthly_agg.items():
            cal_month = ((mabs - 1) % 12) + 1
            if cal_month not in seasonal:
                seasonal[cal_month] = []
            if isinstance(seasonal[cal_month], list):
                seasonal[cal_month].append(val)

        coeff_saisonnier: dict[int, float] = {}
        for m_cal, vals in seasonal.items():
            if isinstance(vals, list) and vals:
                coeff_saisonnier[m_cal] = (sum(vals) / len(vals)) / max(avg_global, 1)
            else:
                coeff_saisonnier[m_cal] = 1.0

        # Projeter
        base_mabs = (year - min(ref_years)) * 12
        projections = {}
        for m in range(1, 13):
            mabs = base_mabs + m
            trend = slope * mabs + intercept
            coeff = coeff_saisonnier.get(m, 1.0)
            projections[m] = max(0, trend * coeff)

        result[cat] = projections
        result[f"_r2_{cat}"] = round(r2, 4)

    return result


# ════════════════════════════════════════════════════
#  Settings
# ════════════════════════════════════════════════════


def get_settings() -> PrevSettings:
    data = _load_json(PREV_SETTINGS_FILE, {})
    return PrevSettings(**data) if data else PrevSettings()


def update_settings(settings: PrevSettings) -> PrevSettings:
    _save_json(PREV_SETTINGS_FILE, settings.model_dump())
    return settings
