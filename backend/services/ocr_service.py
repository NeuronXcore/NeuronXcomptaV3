"""
Service OCR — EasyOCR pour extraction de texte depuis des PDF.
Extraction automatique de dates, montants et fournisseurs.
Cache des résultats en .ocr.json à côté des PDF.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from backend.core.config import (
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    JUSTIFICATIFS_TEMP_DIR,
    ensure_directories,
)

logger = logging.getLogger(__name__)

# ─── Singleton EasyOCR Reader ───

_reader = None
_reader_lock = threading.Lock()
_easyocr_available = None


def _check_easyocr_available() -> bool:
    """Vérifie si easyocr est installé."""
    global _easyocr_available
    if _easyocr_available is None:
        try:
            import easyocr  # noqa: F401
            _easyocr_available = True
        except ImportError:
            _easyocr_available = False
    return _easyocr_available


def _check_poppler_available() -> bool:
    """Vérifie si poppler (pdf2image) est disponible."""
    try:
        import subprocess
        result = subprocess.run(["pdftoppm", "-v"], capture_output=True, timeout=5)
        return True
    except Exception:
        # Try alternative check
        try:
            from pdf2image import convert_from_bytes
            return True
        except Exception:
            return False


def _get_reader():
    """Retourne le reader EasyOCR (singleton, lazy-loaded)."""
    global _reader
    if _reader is None:
        with _reader_lock:
            if _reader is None:
                try:
                    import easyocr
                    logger.info("Initialisation EasyOCR (fr, en)...")
                    _reader = easyocr.Reader(["fr", "en"], gpu=False)
                    logger.info("EasyOCR initialisé avec succès")
                except Exception as e:
                    logger.error(f"Erreur initialisation EasyOCR: {e}")
                    raise
    return _reader


# ─── Cache ───

def _ocr_cache_path(pdf_path: Path) -> Path:
    """Retourne le chemin du fichier cache OCR."""
    return pdf_path.with_suffix(".ocr.json")


def get_cached_result(pdf_path: Path) -> Optional[dict]:
    """Charge le résultat OCR depuis le cache."""
    cache = _ocr_cache_path(pdf_path)
    if cache.exists():
        try:
            with open(cache, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def _save_cache(pdf_path: Path, result: dict):
    """Sauvegarde le résultat OCR dans le cache."""
    cache = _ocr_cache_path(pdf_path)
    try:
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Erreur sauvegarde cache OCR: {e}")


def delete_cached_result(pdf_path: Path) -> bool:
    """Supprime le fichier cache OCR."""
    cache = _ocr_cache_path(pdf_path)
    if cache.exists():
        cache.unlink()
        return True
    return False


def _find_ocr_cache_file(filename: str) -> Optional[Path]:
    """Cherche le fichier .ocr.json dans en_attente/ et traites/."""
    # with_suffix remplace uniquement le dernier suffix — correct même pour
    # des noms historiques à double extension type `*.pdf.pdf`.
    if filename.endswith(".pdf"):
        cache_name = Path(filename).with_suffix(".ocr.json").name
    else:
        cache_name = f"{filename}.ocr.json"
    for dir_path in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        cache = dir_path / cache_name
        if cache.exists():
            return cache
    return None


def update_extracted_data(filename: str, edits: dict) -> dict:
    """Met à jour manuellement les données extraites OCR."""
    cache_path = _find_ocr_cache_file(filename)
    if not cache_path:
        raise FileNotFoundError(f"Pas de résultat OCR pour {filename}")

    with open(cache_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    ed = data.get("extracted_data", {})

    # Mettre à jour les champs fournis
    if edits.get("best_amount") is not None:
        ed["best_amount"] = edits["best_amount"]
        # Ajouter aux amounts si pas présent
        amounts = ed.get("amounts", [])
        if edits["best_amount"] not in amounts:
            amounts.append(edits["best_amount"])
            ed["amounts"] = amounts

    if edits.get("best_date") is not None:
        ed["best_date"] = edits["best_date"]
        # Ajouter aux dates si pas présent
        dates = ed.get("dates", [])
        if edits["best_date"] not in dates:
            dates.append(edits["best_date"])
            ed["dates"] = dates

    if edits.get("supplier") is not None:
        ed["supplier"] = edits["supplier"]

    data["extracted_data"] = ed

    # Hints catégorie/sous-catégorie — stockés au TOP-LEVEL du dict, pas dans
    # extracted_data, pour ne pas polluer les arrays OCR.
    # None ou "" = suppression de la clé (reset hint).
    for hint_key in ("category_hint", "sous_categorie_hint"):
        if hint_key in edits:
            val = edits[hint_key]
            if val:
                data[hint_key] = val
            else:
                data.pop(hint_key, None)

    data["manual_edit"] = True
    data["manual_edit_at"] = datetime.now().isoformat()

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return ed


# ─── Convention de nommage ───

_MONTANT_FILENAME_RE = re.compile(r'^\d+[.,]\d{2}$')


def _parse_filename_convention(filename: str) -> Optional[dict]:
    """Parse la convention fournisseur_YYYYMMDD_montant.pdf.

    Retourne {"supplier": ..., "date": ..., "amount": ...} ou None.
    Chaque champ peut etre None si vide ou invalide.
    Retourne None si le filename ne suit pas la convention (!= 3 segments).
    """
    stem = Path(filename).stem
    parts = stem.split("_")
    if len(parts) != 3:
        return None

    raw_supplier, raw_date, raw_amount = parts

    # Fournisseur
    supplier: Optional[str] = None
    if raw_supplier:
        supplier = raw_supplier.replace("-", " ").title()

    # Date
    date_iso: Optional[str] = None
    if raw_date and len(raw_date) == 8 and raw_date.isdigit():
        try:
            parsed = datetime.strptime(raw_date, "%Y%m%d")
            date_iso = parsed.strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Montant
    amount: Optional[float] = None
    if raw_amount and _MONTANT_FILENAME_RE.match(raw_amount):
        try:
            amount = float(raw_amount.replace(",", "."))
        except ValueError:
            pass

    return {"supplier": supplier, "date": date_iso, "amount": amount}


def _detect_facsimile(filename: Optional[str]) -> bool:
    """Détecte un fac-similé reconstitué (nouveau format `_fs` ou legacy `reconstitue_`).

    Délégué à `rename_service.is_facsimile` via lazy import pour éviter les circulaires.
    """
    if not filename:
        return False
    try:
        from backend.services import rename_service
        return rename_service.is_facsimile(filename)
    except Exception:
        # Fallback : détection minimale
        return filename.startswith("reconstitue_") or "_fs.pdf" in filename.lower()


# ─── Extraction ───

def extract_from_pdf(pdf_path: Path, original_filename: Optional[str] = None) -> dict:
    """Extraction OCR complète depuis un PDF."""
    start_time = time.time()
    filename = pdf_path.name

    # Parser la convention de nommage (sur le nom original si disponible)
    fn_parsed = _parse_filename_convention(original_filename or filename)

    try:
        # Convertir PDF en images
        from pdf2image import convert_from_path
        images = convert_from_path(str(pdf_path), dpi=200, fmt="jpeg")
        page_count = len(images)

        if page_count == 0:
            return _make_result(filename, "no_text", "", 0, 0, start_time,
                                original_filename=original_filename, filename_parsed=fn_parsed)

        # OCR sur chaque page
        reader = _get_reader()
        all_text = []
        total_confidence = 0.0
        total_items = 0

        for img in images:
            import numpy as np
            img_array = np.array(img)
            results = reader.readtext(img_array)

            for _, text, conf in results:
                all_text.append(text)
                total_confidence += conf
                total_items += 1

        raw_text = "\n".join(all_text)
        avg_confidence = total_confidence / total_items if total_items > 0 else 0.0

        if not raw_text.strip():
            return _make_result(filename, "no_text", "", page_count, 0.0, start_time,
                                original_filename=original_filename, filename_parsed=fn_parsed)

        # Parsing OCR
        dates = _extract_dates(raw_text)
        amounts = _extract_amounts(raw_text)
        supplier = _extract_supplier(raw_text)

        result = _make_result(
            filename, "success", raw_text, page_count, avg_confidence, start_time,
            dates=dates, amounts=amounts, supplier=supplier,
            original_filename=original_filename, filename_parsed=fn_parsed,
        )

        # Sauvegarder le cache
        _save_cache(pdf_path, result)
        logger.info(f"OCR extrait: {filename} → {len(dates)} dates, {len(amounts)} montants")

        # GED V2: enrich metadata with OCR data
        try:
            from backend.services import ged_service
            extracted = result.get("extracted_data", {})
            ged_service.enrich_metadata_on_ocr(
                justificatif_filename=filename,
                fournisseur=extracted.get("supplier"),
                date_document=extracted.get("best_date"),
                montant=extracted.get("best_amount"),
                is_reconstitue=_detect_facsimile(filename),
            )
        except Exception:
            pass

        return result

    except Exception as e:
        logger.error(f"Erreur OCR sur {filename}: {e}")
        return _make_result(filename, "error", str(e), 0, 0.0, start_time,
                            original_filename=original_filename, filename_parsed=fn_parsed)


def _make_result(
    filename: str, status: str, raw_text: str,
    page_count: int, confidence: float, start_time: float,
    dates: Optional[List[str]] = None,
    amounts: Optional[List[float]] = None,
    supplier: Optional[str] = None,
    original_filename: Optional[str] = None,
    filename_parsed: Optional[dict] = None,
) -> dict:
    """Construit le dict résultat OCR avec override filename si convention."""
    elapsed_ms = int((time.time() - start_time) * 1000)
    dates = dates or []
    amounts = amounts or []

    # Sélection OCR de base
    best_date = _select_best_date(raw_text, dates)
    best_amount = _select_best_amount(raw_text, amounts)

    # Override par les valeurs du filename (priorité filename > OCR)
    if filename_parsed:
        fp_amount = filename_parsed.get("amount")
        fp_date = filename_parsed.get("date")
        fp_supplier = filename_parsed.get("supplier")

        if fp_amount is not None:
            best_amount = fp_amount
            if fp_amount not in amounts:
                amounts.insert(0, fp_amount)
        if fp_date is not None:
            best_date = fp_date
            if fp_date not in dates:
                dates.insert(0, fp_date)
        if fp_supplier is not None:
            supplier = fp_supplier

    result = {
        "filename": filename,
        "processed_at": datetime.now().isoformat(),
        "status": status,
        "processing_time_ms": elapsed_ms,
        "raw_text": raw_text[:5000],
        "extracted_data": {
            "dates": dates,
            "amounts": amounts,
            "supplier": supplier,
            "best_date": best_date,
            "best_amount": best_amount,
        },
        "page_count": page_count,
        "confidence": round(confidence, 3),
        "filename_parsed": filename_parsed,
    }
    if original_filename:
        result["original_filename"] = original_filename
    return result


def extract_or_cached(pdf_path: Path, original_filename: Optional[str] = None) -> dict:
    """Retourne le résultat caché ou lance l'extraction."""
    cached = get_cached_result(pdf_path)
    if cached:
        return cached
    return extract_from_pdf(pdf_path, original_filename=original_filename)


# ─── Parsing : Dates ───

MOIS_FR_MAP = {
    "janvier": "01", "février": "02", "mars": "03", "avril": "04",
    "mai": "05", "juin": "06", "juillet": "07", "août": "08",
    "septembre": "09", "octobre": "10", "novembre": "11", "décembre": "12",
    "fevrier": "02", "aout": "08", "decembre": "12",
    "jan": "01", "fév": "02", "fev": "02", "avr": "04",
    "juil": "07", "sept": "09", "oct": "10", "nov": "11", "déc": "12", "dec": "12",
}


def _extract_dates(text: str) -> List[str]:
    """Extrait les dates depuis le texte OCR, retourne en format ISO."""
    dates = []
    seen = set()

    # Pattern DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
    for match in re.finditer(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", text):
        day, month, year = match.groups()
        day_int, month_int, year_int = int(day), int(month), int(year)
        if 1 <= day_int <= 31 and 1 <= month_int <= 12 and 1900 <= year_int <= 2100:
            iso = f"{year_int}-{month_int:02d}-{day_int:02d}"
            if iso not in seen:
                dates.append(iso)
                seen.add(iso)

    # Pattern DD/MM/YY
    for match in re.finditer(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})(?!\d)", text):
        day, month, year_short = match.groups()
        day_int, month_int = int(day), int(month)
        year_int = 2000 + int(year_short) if int(year_short) < 50 else 1900 + int(year_short)
        if 1 <= day_int <= 31 and 1 <= month_int <= 12:
            iso = f"{year_int}-{month_int:02d}-{day_int:02d}"
            if iso not in seen:
                dates.append(iso)
                seen.add(iso)

    # Pattern "15 janvier 2024" ou "15 jan 2024"
    months_pattern = "|".join(MOIS_FR_MAP.keys())
    for match in re.finditer(
        rf"(\d{{1,2}})\s+({months_pattern})\s+(\d{{4}})", text, re.IGNORECASE
    ):
        day, month_name, year = match.groups()
        month_num = MOIS_FR_MAP.get(month_name.lower())
        if month_num:
            iso = f"{year}-{month_num}-{int(day):02d}"
            if iso not in seen:
                dates.append(iso)
                seen.add(iso)

    return dates


def _select_best_date(text: str, dates: List[str]) -> Optional[str]:
    """Sélectionne la meilleure date (date de facture) parmi les dates extraites."""
    if not dates:
        return None
    if len(dates) == 1:
        return dates[0]

    dates_set = set(dates)
    lines = text.split("\n")

    # Mots-clés d'exclusion (lignes à ignorer pour la sélection)
    exclude_kw = ["échéance", "echeance", "règlement", "reglement",
                   "mise en circulation", "naissance", "création", "creation", "prochaine"]
    # Mots-clés de priorité
    facture_kw = ["facture", "émission", "emission", ":", "du"]

    def _find_date_in_lines(idx: int) -> Optional[str]:
        """Cherche une date sur la ligne idx, puis sur les 3 lignes suivantes si vide."""
        for d in dates:
            if _date_in_line(d, lines[idx]):
                return d
        for offset in range(1, 4):
            if idx + offset < len(lines):
                for d in dates:
                    if _date_in_line(d, lines[idx + offset]):
                        return d
        return None

    # Passe 1 : ligne contenant "date" + mot-clé facture
    for i, line in enumerate(lines):
        low = line.lower()
        if any(ek in low for ek in exclude_kw):
            continue
        if "date" in low:
            has_facture_kw = any(fk in low for fk in facture_kw)
            if has_facture_kw:
                found = _find_date_in_lines(i)
                if found:
                    return found

    # Passe 2 : ligne contenant "date" seul
    for i, line in enumerate(lines):
        low = line.lower()
        if any(ek in low for ek in exclude_kw):
            continue
        if "date" in low:
            found = _find_date_in_lines(i)
            if found:
                return found

    # Fallback : date la plus récente ≤ aujourd'hui
    today = datetime.now().date()
    valid_dates = []
    for d in dates:
        try:
            parsed = datetime.strptime(d, "%Y-%m-%d").date()
            if parsed <= today:
                valid_dates.append((parsed, d))
        except ValueError:
            continue
    if valid_dates:
        valid_dates.sort(reverse=True)
        return valid_dates[0][1]

    return dates[0]


_MOIS_REVERSE = {
    1: ["janvier", "jan"],
    2: ["février", "fevrier", "fév", "fev"],
    3: ["mars"],
    4: ["avril", "avr"],
    5: ["mai"],
    6: ["juin"],
    7: ["juillet", "juil"],
    8: ["août", "aout"],
    9: ["septembre", "sept"],
    10: ["octobre", "oct"],
    11: ["novembre", "nov"],
    12: ["décembre", "decembre", "déc", "dec"],
}


def _date_in_line(iso_date: str, line: str) -> bool:
    """Vérifie si une date ISO est présente dans une ligne (sous n'importe quel format)."""
    try:
        parsed = datetime.strptime(iso_date, "%Y-%m-%d")
        # Formats numériques
        for fmt in [
            f"{parsed.day:02d}/{parsed.month:02d}/{parsed.year}",
            f"{parsed.day}/{parsed.month:02d}/{parsed.year}",
            f"{parsed.day:02d}-{parsed.month:02d}-{parsed.year}",
            f"{parsed.day:02d}.{parsed.month:02d}.{parsed.year}",
            f"{parsed.day:02d}/{parsed.month:02d}/{parsed.year % 100:02d}",
        ]:
            if fmt in line:
                return True
        # Format mois en toutes lettres : "18 juillet 2025"
        low_line = line.lower()
        for month_name in _MOIS_REVERSE.get(parsed.month, []):
            if month_name in low_line and str(parsed.year) in line:
                day_str = str(parsed.day)
                if day_str in line:
                    return True
    except ValueError:
        pass
    return False


# ─── Parsing : Montants ───

_AMOUNT_RE = re.compile(r'\b(\d{1,3}(?:[\s\u00a0]?\d{3})*[.,]\d{2})\b')
_DATE_LIKE_RE = re.compile(r'\d{2}[/\-]\d{2}[/\-]\d{2,4}')


def _extract_amounts(text: str) -> List[float]:
    """Extrait les montants depuis le texte OCR."""
    seen: set[float] = set()
    amounts: List[float] = []

    for line in text.split("\n"):
        for match in _AMOUNT_RE.finditer(line):
            raw = match.group(1)
            end_pos = match.end()

            # Exclure si suivi de % → taux TVA
            rest = line[end_pos:end_pos + 3].lstrip()
            if rest.startswith("%"):
                continue

            # Exclure si le match fait partie d'un pattern date
            span_text = line[max(0, match.start() - 5):match.end() + 5]
            if _DATE_LIKE_RE.search(span_text):
                continue

            # Convertir en float
            cleaned = raw.replace(" ", "").replace("\u00a0", "").replace(",", ".")
            try:
                value = float(cleaned)
            except ValueError:
                continue

            if 0 < value < 1_000_000 and value not in seen:
                amounts.append(value)
                seen.add(value)

    return amounts


def _select_best_amount(text: str, amounts: List[float]) -> Optional[float]:
    """Sélectionne le montant TTC parmi les montants extraits."""
    if not amounts:
        return None
    if len(amounts) == 1:
        return amounts[0]

    amounts_set = set(amounts)
    lines = text.split("\n")

    def _get_nearby_amounts(idx: int) -> List[float]:
        """Cherche les montants sur la ligne idx et les 3 lignes suivantes."""
        found: List[float] = []
        seen_nearby: set[float] = set()
        for offset in range(0, 4):
            if idx + offset >= len(lines):
                break
            for a in amounts:
                if a not in seen_nearby and _amount_in_line(a, lines[idx + offset]):
                    found.append(a)
                    seen_nearby.add(a)
        return found

    # Collecter les candidats TTC depuis plusieurs sources
    candidates: List[float] = []

    # Source 1 : ligne contenant "total" + "facture"
    for i, line in enumerate(lines):
        low = line.lower()
        if "total" in low and "facture" in low:
            found = _get_nearby_amounts(i)
            if found:
                candidates.append(max(found))

    # Source 2 : ligne contenant "ttc" AVEC un montant sur la même ligne
    for i, line in enumerate(lines):
        low = line.lower()
        if ("ht" in low or "hors taxe" in low) and "ttc" not in low:
            continue
        if "ttc" in low:
            same_line = [a for a in amounts if _amount_in_line(a, line)]
            if same_line:
                candidates.append(max(same_line))

    # Source 3 : tous les "total" seuls (pas sous-total, pas total ht, pas total facture)
    for i, line in enumerate(lines):
        low = line.lower()
        if "total" not in low:
            continue
        if "sous-total" in low or "sous total" in low:
            continue
        if ("ht" in low or "hors taxe" in low) and "ttc" not in low:
            continue
        if "facture" in low:
            continue  # déjà traité en source 1
        found = _get_nearby_amounts(i)
        if found:
            candidates.append(max(found))

    # Retourner le max des candidats (le TTC est le plus grand)
    if candidates:
        return max(candidates)

    # Priorité 4 : montant le plus proche de €
    best_euro = _find_amount_near_euro(text, amounts)
    if best_euro is not None:
        return best_euro

    # Fallback : max
    return max(amounts)


def _amount_in_line(amount: float, line: str) -> bool:
    """Vérifie si un montant est présent dans une ligne."""
    # Chercher sous forme virgule ou point
    s_comma = f"{amount:,.2f}".replace(",", " ").replace(".", ",")  # 1 234,56
    s_simple = f"{amount:.2f}".replace(".", ",")  # 1234,56
    s_dot = f"{amount:.2f}"  # 1234.56
    clean_line = line.replace("\u00a0", " ")
    return s_comma in clean_line or s_simple in clean_line or s_dot in clean_line


def _find_amount_near_euro(text: str, amounts: List[float]) -> Optional[float]:
    """Trouve le montant le plus proche d'un symbole € dans le texte."""
    euro_positions = [m.start() for m in re.finditer(r'€|EUR', text, re.IGNORECASE)]
    if not euro_positions:
        return None

    best: Optional[float] = None
    best_dist = 999999

    for amt in amounts:
        for match in _AMOUNT_RE.finditer(text):
            cleaned = match.group(1).replace(" ", "").replace("\u00a0", "").replace(",", ".")
            try:
                val = float(cleaned)
            except ValueError:
                continue
            if abs(val - amt) > 0.001:
                continue
            for ep in euro_positions:
                dist = abs(match.start() - ep)
                if dist < best_dist:
                    best_dist = dist
                    best = amt

    return best


# ─── Parsing : Fournisseur ───

SUPPLIER_KEYWORDS = [
    "SARL", "SA ", "SAS", "EURL", "SCI", "SASU", "SCP", "SELARL",
    "ENTREPRISE", "SOCIÉTÉ", "SOCIETE", "CABINET",
    "PHARMACIE", "CLINIQUE", "LABORATOIRE",
    "EDF", "ENGIE", "ORANGE", "FREE", "SFR", "BOUYGUES",
]

_SUPPLIER_FORM_RE = re.compile(
    r'\b(?:Bank|SAS|SARL|SA|SCI|EURL|SCP|SELARL|plc|GmbH|Ltd|Inc)\b',
    re.IGNORECASE,
)
_POSTAL_CODE_RE = re.compile(r'\b\d{5}\b')


def _extract_supplier(text: str) -> Optional[str]:
    """Tente d'identifier le fournisseur depuis le texte OCR."""
    lines = text.split("\n")

    # Première passe : mots-clés société connus
    for line in lines:
        line_upper = line.upper().strip()
        for keyword in SUPPLIER_KEYWORDS:
            if keyword in line_upper and len(line.strip()) > 3:
                return re.sub(r'\s+', ' ', line.strip())[:80]

    # Deuxième passe (fallback) : forme juridique dans les 10 premières lignes
    non_empty_lines = [l.strip() for l in lines if l.strip()]
    for line in non_empty_lines[:10]:
        if _SUPPLIER_FORM_RE.search(line):
            return re.sub(r'\s+', ' ', line.strip())[:80]

    # Troisième passe : première ligne non-vide sans code postal, date ni montant seul
    for line in non_empty_lines[:10]:
        stripped = line.strip()
        if len(stripped) < 3:
            continue
        if _POSTAL_CODE_RE.search(stripped):
            continue
        if _DATE_LIKE_RE.search(stripped):
            continue
        # Ignorer les lignes qui sont juste un montant
        if _AMOUNT_RE.fullmatch(stripped):
            continue
        return re.sub(r'\s+', ' ', stripped)[:80]

    return None


# ─── Statut ───

def get_ocr_status() -> dict:
    """Retourne le statut du système OCR."""
    ensure_directories()

    # Compter les extractions (fichiers .ocr.json)
    total = 0
    for dir_path in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        if dir_path.exists():
            total += len(list(dir_path.glob("*.ocr.json")))

    return {
        "reader_loaded": _reader is not None,
        "easyocr_available": _check_easyocr_available(),
        "poppler_available": _check_poppler_available(),
        "total_extractions": total,
    }


# ─── Historique ───

def get_extraction_history(limit: int = 20) -> list:
    """Retourne l'historique des extractions OCR."""
    results = []

    for dir_path in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        if not dir_path.exists():
            continue
        for cache_file in dir_path.glob("*.ocr.json"):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                ed = data.get("extracted_data", {})
                # Source authoritative du filename = le PDF sibling sur disque,
                # pas le champ JSON `filename` qui peut être stale (ex. fichier
                # renommé mais JSON non re-synchronisé). Évite les 404 en aval
                # quand l'utilisateur clique sur un nom obsolète.
                pdf_filename = cache_file.name[:-len(".ocr.json")] + ".pdf"
                pdf_path = cache_file.with_name(pdf_filename)
                if not pdf_path.exists():
                    # Fallback legacy : on garde l'ancien comportement si le PDF
                    # sibling a un nom vraiment différent (rare).
                    pdf_filename = data.get("filename") or pdf_filename
                results.append({
                    "filename": pdf_filename,
                    "processed_at": data.get("processed_at", ""),
                    "status": data.get("status", "unknown"),
                    "processing_time_ms": data.get("processing_time_ms", 0),
                    "dates_found": ed.get("dates", []),
                    "amounts_found": ed.get("amounts", []),
                    "supplier": ed.get("supplier"),
                    "confidence": data.get("confidence", 0),
                    "best_date": ed.get("best_date"),
                    "best_amount": ed.get("best_amount"),
                    "original_filename": data.get("original_filename") or data.get("renamed_from"),
                    "auto_renamed": bool(data.get("renamed_from")),
                    # Hints cat/sous-cat (top-level, pas dans extracted_data)
                    "category_hint": data.get("category_hint"),
                    "sous_categorie_hint": data.get("sous_categorie_hint"),
                })
            except Exception:
                continue

    results.sort(key=lambda r: r["processed_at"], reverse=True)
    return results[:limit]


# ─── Helpers pour intégration justificatifs ───

def move_ocr_cache(src_dir: Path, dst_dir: Path, pdf_filename: str):
    """Déplace le fichier cache OCR d'un répertoire à l'autre."""
    # with_suffix remplace uniquement le dernier suffix — correct même pour
    # des noms historiques à double extension type `*.pdf.pdf`.
    cache_name = Path(pdf_filename).with_suffix(".ocr.json").name
    src = src_dir / cache_name
    dst = dst_dir / cache_name
    if src.exists():
        shutil.move(str(src), str(dst))


def delete_ocr_cache_for(pdf_path: Path):
    """Supprime le cache OCR associé à un PDF."""
    delete_cached_result(pdf_path)


def get_ocr_summary(pdf_path: Path) -> Optional[dict]:
    """Retourne un résumé OCR compact pour l'affichage."""
    cached = get_cached_result(pdf_path)
    if cached and cached.get("status") == "success":
        ed = cached.get("extracted_data", {})
        return {
            "best_date": ed.get("best_date"),
            "best_amount": ed.get("best_amount"),
            "supplier": ed.get("supplier"),
            "processed": True,
        }
    elif cached:
        return {"processed": True, "best_date": None, "best_amount": None, "supplier": None}
    return None
