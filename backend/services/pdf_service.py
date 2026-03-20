"""
Service pour l'extraction de données depuis des PDF.
Refactoré depuis utils/pdf_operations.py de V2.
"""

import io
import logging

import pandas as pd
import pdfplumber

logger = logging.getLogger(__name__)


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extrait tout le texte d'un PDF."""
    text = ""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n\n"
        return text
    except Exception as e:
        logger.error(f"Erreur extraction texte PDF: {e}")
        return ""


def extract_tables_from_pdf(pdf_bytes: bytes) -> dict[str, list[list]]:
    """Extrait les tables d'un PDF."""
    tables = {}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, page in enumerate(pdf.pages):
                page_tables = page.extract_tables()
                if page_tables:
                    for j, table in enumerate(page_tables):
                        table = [row for row in table if any(cell for cell in row)]
                        if len(table) > 1:
                            tables[f"page_{i+1}_table_{j+1}"] = table
        return tables
    except Exception as e:
        logger.error(f"Erreur extraction tables PDF: {e}")
        return {}


def validate_pdf(pdf_bytes: bytes) -> bool:
    """Vérifie si le contenu est un PDF valide."""
    if not pdf_bytes.startswith(b"%PDF-"):
        return False
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return len(pdf.pages) > 0
    except Exception:
        return False
