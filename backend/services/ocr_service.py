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


# ─── Extraction ───

def extract_from_pdf(pdf_path: Path) -> dict:
    """Extraction OCR complète depuis un PDF."""
    start_time = time.time()
    filename = pdf_path.name

    try:
        # Convertir PDF en images
        from pdf2image import convert_from_path
        images = convert_from_path(str(pdf_path), dpi=200, fmt="jpeg")
        page_count = len(images)

        if page_count == 0:
            return _make_result(filename, "no_text", "", 0, 0, start_time)

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
            return _make_result(filename, "no_text", "", page_count, 0.0, start_time)

        # Parsing
        dates = _extract_dates(raw_text)
        amounts = _extract_amounts(raw_text)
        supplier = _extract_supplier(raw_text)

        result = _make_result(
            filename, "success", raw_text, page_count, avg_confidence, start_time,
            dates=dates, amounts=amounts, supplier=supplier,
        )

        # Sauvegarder le cache
        _save_cache(pdf_path, result)
        logger.info(f"OCR extrait: {filename} → {len(dates)} dates, {len(amounts)} montants")

        return result

    except Exception as e:
        logger.error(f"Erreur OCR sur {filename}: {e}")
        return _make_result(filename, "error", str(e), 0, 0.0, start_time)


def _make_result(
    filename: str, status: str, raw_text: str,
    page_count: int, confidence: float, start_time: float,
    dates: Optional[List[str]] = None,
    amounts: Optional[List[float]] = None,
    supplier: Optional[str] = None,
) -> dict:
    """Construit le dict résultat OCR."""
    elapsed_ms = int((time.time() - start_time) * 1000)
    dates = dates or []
    amounts = amounts or []

    return {
        "filename": filename,
        "processed_at": datetime.now().isoformat(),
        "status": status,
        "processing_time_ms": elapsed_ms,
        "raw_text": raw_text[:5000],  # Limiter la taille
        "extracted_data": {
            "dates": dates,
            "amounts": amounts,
            "supplier": supplier,
            "best_date": dates[0] if dates else None,
            "best_amount": max(amounts) if amounts else None,
        },
        "page_count": page_count,
        "confidence": round(confidence, 3),
    }


def extract_or_cached(pdf_path: Path) -> dict:
    """Retourne le résultat caché ou lance l'extraction."""
    cached = get_cached_result(pdf_path)
    if cached:
        return cached
    return extract_from_pdf(pdf_path)


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


# ─── Parsing : Montants ───

def _extract_amounts(text: str) -> List[float]:
    """Extrait les montants depuis le texte OCR."""
    amounts = []
    seen = set()

    # Patterns : 1 234,56 € / 1234.56 EUR / 45,90€ / EUR 123.45
    patterns = [
        r"(\d[\d\s]*\d),(\d{2})\s*(?:€|EUR|eur)",  # 1 234,56 € ou 45,90€
        r"(?:€|EUR|eur)\s*(\d[\d\s]*\d),(\d{2})",   # € 1 234,56
        r"(\d[\d\s]*\d)\.(\d{2})\s*(?:€|EUR|eur)",  # 1234.56 EUR
        r"(?:€|EUR|eur)\s*(\d[\d\s]*\d)\.(\d{2})",  # EUR 1234.56
        r"(\d{1,6}),(\d{2})\s*€",                    # Simple: 45,90 €
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            try:
                int_part = match.group(1).replace(" ", "").replace("\u00a0", "")
                dec_part = match.group(2)
                amount = float(f"{int_part}.{dec_part}")
                if 0.01 <= amount <= 100000 and amount not in seen:
                    amounts.append(amount)
                    seen.add(amount)
            except (ValueError, IndexError):
                continue

    return sorted(amounts, reverse=True)


# ─── Parsing : Fournisseur ───

SUPPLIER_KEYWORDS = [
    "SARL", "SA ", "SAS", "EURL", "SCI", "SASU",
    "ENTREPRISE", "SOCIÉTÉ", "SOCIETE", "CABINET",
    "PHARMACIE", "CLINIQUE", "LABORATOIRE",
    "EDF", "ENGIE", "ORANGE", "FREE", "SFR", "BOUYGUES",
]


def _extract_supplier(text: str) -> Optional[str]:
    """Tente d'identifier le fournisseur depuis le texte OCR."""
    lines = text.split("\n")
    for line in lines:
        line_upper = line.upper().strip()
        for keyword in SUPPLIER_KEYWORDS:
            if keyword in line_upper and len(line.strip()) > 3:
                # Retourner la ligne nettoyée
                return line.strip()[:80]
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
                results.append({
                    "filename": data.get("filename", cache_file.stem),
                    "processed_at": data.get("processed_at", ""),
                    "status": data.get("status", "unknown"),
                    "processing_time_ms": data.get("processing_time_ms", 0),
                    "dates_found": data.get("extracted_data", {}).get("dates", []),
                    "amounts_found": data.get("extracted_data", {}).get("amounts", []),
                    "supplier": data.get("extracted_data", {}).get("supplier"),
                    "confidence": data.get("confidence", 0),
                })
            except Exception:
                continue

    results.sort(key=lambda r: r["processed_at"], reverse=True)
    return results[:limit]


# ─── Helpers pour intégration justificatifs ───

def move_ocr_cache(src_dir: Path, dst_dir: Path, pdf_filename: str):
    """Déplace le fichier cache OCR d'un répertoire à l'autre."""
    cache_name = pdf_filename.replace(".pdf", ".ocr.json")
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
