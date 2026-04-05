"""
Service pour les templates de justificatifs.
CRUD, extraction OCR, suggestion, génération PDF reconstitués.
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    TEMPLATES_FILE,
    TEMPLATES_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
    ensure_directories,
)
from backend.models.template import (
    JustificatifTemplate,
    TemplateCreateRequest,
    TemplateField,
    TemplateStore,
    GenerateRequest,
    TemplateSuggestion,
)

logger = logging.getLogger(__name__)


# ──── Persistence ────


def load_templates() -> TemplateStore:
    """Charge les templates depuis le fichier JSON."""
    if TEMPLATES_FILE.exists():
        try:
            with open(TEMPLATES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return TemplateStore(**data)
        except Exception as e:
            logger.error(f"Erreur chargement templates: {e}")
    return TemplateStore()


def save_templates(store: TemplateStore) -> None:
    """Sauvegarde les templates."""
    ensure_directories()
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    with open(TEMPLATES_FILE, "w", encoding="utf-8") as f:
        json.dump(store.model_dump(), f, ensure_ascii=False, indent=2, default=str)


# ──── CRUD ────


def get_template(template_id: str) -> Optional[JustificatifTemplate]:
    """Retourne un template par ID."""
    store = load_templates()
    for tpl in store.templates:
        if tpl.id == template_id:
            return tpl
    return None


def create_template(request: TemplateCreateRequest) -> JustificatifTemplate:
    """Crée un nouveau template."""
    store = load_templates()
    short_uuid = uuid.uuid4().hex[:8]
    tpl = JustificatifTemplate(
        id=f"tpl_{short_uuid}",
        vendor=request.vendor,
        vendor_aliases=request.vendor_aliases,
        category=request.category,
        sous_categorie=request.sous_categorie,
        source_justificatif=request.source_justificatif,
        fields=request.fields,
        created_at=datetime.now().isoformat(),
        created_from="manual",
        usage_count=0,
    )
    store.templates.append(tpl)
    save_templates(store)
    return tpl


def update_template(template_id: str, request: TemplateCreateRequest) -> Optional[JustificatifTemplate]:
    """Met à jour un template existant."""
    store = load_templates()
    for i, tpl in enumerate(store.templates):
        if tpl.id == template_id:
            updated = tpl.model_copy(update={
                "vendor": request.vendor,
                "vendor_aliases": request.vendor_aliases,
                "category": request.category,
                "sous_categorie": request.sous_categorie,
                "source_justificatif": request.source_justificatif,
                "fields": request.fields,
            })
            store.templates[i] = updated
            save_templates(store)
            return updated
    return None


def delete_template(template_id: str) -> bool:
    """Supprime un template."""
    store = load_templates()
    original_len = len(store.templates)
    store.templates = [t for t in store.templates if t.id != template_id]
    if len(store.templates) < original_len:
        save_templates(store)
        return True
    return False


# ──── Extraction OCR ────


def extract_fields_from_justificatif(filename: str) -> dict:
    """
    Extrait les champs structurés d'un justificatif existant.
    Tente Ollama/Qwen2-VL d'abord, fallback sur les données .ocr.json basiques.
    """
    # Chercher le fichier et son cache OCR
    pdf_path = _find_justificatif(filename)
    if not pdf_path:
        return {"vendor": "", "suggested_aliases": [], "detected_fields": []}

    ocr_cache = pdf_path.with_suffix(".ocr.json")
    ocr_data = {}
    if ocr_cache.exists():
        try:
            with open(ocr_cache, "r", encoding="utf-8") as f:
                ocr_data = json.load(f)
        except Exception:
            pass

    # Tenter l'extraction enrichie via Ollama/Qwen2-VL
    enriched = _try_ollama_extraction(pdf_path)
    if enriched:
        return enriched

    # Fallback: données OCR basiques
    extracted = ocr_data.get("extracted_data", ocr_data)
    vendor = extracted.get("supplier", "") or ""
    aliases = _generate_aliases(vendor)

    fields = []
    if extracted.get("best_date"):
        fields.append({
            "key": "date",
            "label": "Date",
            "value": extracted["best_date"],
            "type": "date",
            "confidence": 0.8,
            "suggested_source": "operation",
        })
    if extracted.get("best_amount") is not None:
        fields.append({
            "key": "montant_ttc",
            "label": "Montant TTC",
            "value": str(extracted["best_amount"]),
            "type": "currency",
            "confidence": 0.8,
            "suggested_source": "operation",
        })
    if vendor:
        fields.append({
            "key": "fournisseur",
            "label": "Fournisseur",
            "value": vendor,
            "type": "text",
            "confidence": 0.7,
            "suggested_source": "ocr",
        })

    # Ajouter champs TVA standards
    fields.extend([
        {
            "key": "tva_rate",
            "label": "Taux TVA",
            "value": "20",
            "type": "percent",
            "confidence": 0.5,
            "suggested_source": "fixed",
        },
        {
            "key": "montant_ht",
            "label": "Montant HT",
            "value": "",
            "type": "currency",
            "confidence": 0.5,
            "suggested_source": "computed",
        },
        {
            "key": "tva",
            "label": "TVA",
            "value": "",
            "type": "currency",
            "confidence": 0.5,
            "suggested_source": "computed",
        },
    ])

    return {
        "vendor": vendor,
        "suggested_aliases": aliases,
        "detected_fields": fields,
    }


def _try_ollama_extraction(pdf_path: Path) -> Optional[dict]:
    """Tente l'extraction via Ollama/Qwen2-VL. Retourne None si indisponible."""
    try:
        # Vérifier si Ollama est disponible
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return None

        # Vérifier que qwen2-vl est disponible
        if "qwen2-vl" not in result.stdout.lower():
            return None

        # Convertir la première page en image pour Qwen2-VL
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(str(pdf_path), first_page=1, last_page=1, dpi=150)
            if not images:
                return None
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                images[0].save(tmp.name, "PNG")
                img_path = tmp.name
        except Exception:
            return None

        prompt = (
            "Analyse ce justificatif/facture et extrais TOUS les champs structurés visibles. "
            "Réponds UNIQUEMENT en JSON strict, sans commentaire : "
            '{"vendor": "nom du fournisseur", "fields": ['
            '{"label": "...", "value": "...", "type": "text|date|currency|number|percent"}'
            "]} "
            "Types : date pour les dates, currency pour les montants en euros, "
            "number pour les quantités, percent pour les pourcentages, text pour le reste."
        )

        ollama_result = subprocess.run(
            ["ollama", "run", "qwen2-vl", prompt],
            input=f"[image:{img_path}]",
            capture_output=True, text=True, timeout=60,
        )

        # Nettoyer le fichier temporaire
        Path(img_path).unlink(missing_ok=True)

        if ollama_result.returncode != 0:
            return None

        # Parser la réponse JSON
        response_text = ollama_result.stdout.strip()
        # Extraire le JSON de la réponse
        json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if not json_match:
            return None

        parsed = json.loads(json_match.group())
        vendor = parsed.get("vendor", "")
        aliases = _generate_aliases(vendor)

        detected_fields = []
        for field in parsed.get("fields", []):
            key = re.sub(r"[^a-z0-9_]", "_", field.get("label", "").lower().strip())
            detected_fields.append({
                "key": key or f"field_{len(detected_fields)}",
                "label": field.get("label", ""),
                "value": str(field.get("value", "")),
                "type": field.get("type", "text"),
                "confidence": 0.85,
                "suggested_source": "manual",
            })

        return {
            "vendor": vendor,
            "suggested_aliases": aliases,
            "detected_fields": detected_fields,
        }

    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        logger.debug(f"Ollama extraction failed: {e}")
        return None
    except Exception as e:
        logger.debug(f"Ollama extraction error: {e}")
        return None


def _generate_aliases(vendor: str) -> list[str]:
    """Génère des alias de matching depuis le nom du fournisseur."""
    if not vendor:
        return []
    vendor_lower = vendor.lower().strip()
    aliases = [vendor_lower]
    # Variantes sans espaces, tirets, etc.
    simplified = re.sub(r"[^a-z0-9]", "", vendor_lower)
    if simplified and simplified != vendor_lower:
        aliases.append(simplified)
    # Première partie (avant espace)
    parts = vendor_lower.split()
    if len(parts) > 1:
        aliases.append(parts[0])
    return list(dict.fromkeys(aliases))  # deduplicate preserving order


def _find_justificatif(filename: str) -> Optional[Path]:
    """Cherche un justificatif dans en_attente ou traites."""
    for d in [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]:
        p = d / filename
        if p.exists():
            return p
    return None


# ──── Suggestion ────


def suggest_template(libelle: str) -> list[TemplateSuggestion]:
    """Suggère des templates en matchant les alias fournisseurs avec le libellé."""
    if not libelle:
        return []

    store = load_templates()
    libelle_lower = libelle.lower()
    suggestions = []

    for tpl in store.templates:
        best_alias = ""
        best_score = 0.0

        for alias in tpl.vendor_aliases:
            alias_lower = alias.lower()
            if alias_lower in libelle_lower:
                # Score basé sur la longueur du match (plus long = plus précis)
                score = len(alias_lower) / max(len(libelle_lower), 1)
                if score > best_score:
                    best_score = score
                    best_alias = alias

        if best_alias:
            suggestions.append(TemplateSuggestion(
                template_id=tpl.id,
                vendor=tpl.vendor,
                match_score=round(best_score, 4),
                matched_alias=best_alias,
                fields_count=len(tpl.fields),
            ))

    suggestions.sort(key=lambda s: s.match_score, reverse=True)
    return suggestions


# ──── Génération PDF reconstitué ────


def generate_reconstitue(request: GenerateRequest) -> dict:
    """Génère un PDF reconstitué depuis un template + opération."""
    from backend.services import operation_service

    # 1. Charger le template
    tpl = get_template(request.template_id)
    if not tpl:
        raise ValueError(f"Template non trouvé: {request.template_id}")

    # 2. Charger l'opération
    ops = operation_service.load_operations(request.operation_file)
    if not (0 <= request.operation_index < len(ops)):
        raise ValueError(f"Index opération invalide: {request.operation_index}")
    operation = ops[request.operation_index]

    # 3. Construire les valeurs des champs
    field_values = _build_field_values(tpl, operation, request.field_values)

    # 4. Générer le PDF
    vendor_slug = re.sub(r"[^a-z0-9]", "_", tpl.vendor.lower().strip())[:30]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_filename = f"reconstitue_{timestamp}_{vendor_slug}.pdf"
    pdf_path = JUSTIFICATIFS_EN_ATTENTE_DIR / pdf_filename

    _generate_pdf(pdf_path, tpl.vendor, field_values)

    # 5. Créer le .ocr.json compagnon
    ocr_data = {
        "best_date": field_values.get("date", ""),
        "best_amount": field_values.get("montant_ttc"),
        "supplier": tpl.vendor,
        "source": "reconstitue",
        "template_id": tpl.id,
        "generated_at": datetime.now().isoformat(),
        "operation_ref": {
            "file": request.operation_file,
            "index": request.operation_index,
        },
    }
    ocr_path = pdf_path.with_suffix(".ocr.json")
    with open(ocr_path, "w", encoding="utf-8") as f:
        json.dump(ocr_data, f, ensure_ascii=False, indent=2, default=str)

    # 6. Incrémenter usage_count
    store = load_templates()
    for t in store.templates:
        if t.id == tpl.id:
            t.usage_count += 1
            break
    save_templates(store)

    # 7. Auto-association si demandé
    associated = False
    if request.auto_associate:
        try:
            from backend.services import justificatif_service
            associated = justificatif_service.associate(
                pdf_filename, request.operation_file, request.operation_index,
            )
            if associated:
                from backend.services import rapprochement_service
                rapprochement_service.write_rapprochement_metadata(
                    request.operation_file,
                    request.operation_index,
                    score=1.0,
                    mode="reconstitue",
                )
        except Exception as e:
            logger.error(f"Erreur auto-association: {e}")

    return {
        "filename": pdf_filename,
        "associated": associated,
    }


def _build_field_values(
    tpl: JustificatifTemplate,
    operation: dict,
    manual_values: dict,
) -> dict:
    """Construit les valeurs finales de tous les champs."""
    values: dict = {}

    for field in tpl.fields:
        if field.source == "operation":
            if field.key == "date":
                values[field.key] = operation.get("Date", "")
            elif field.key in ("montant_ttc", "montant"):
                # Prendre débit ou crédit
                debit = operation.get("Débit") or operation.get("Debit") or 0
                credit = operation.get("Crédit") or operation.get("Credit") or 0
                amount = debit if debit else credit
                try:
                    values[field.key] = float(amount) if amount else 0.0
                except (ValueError, TypeError):
                    values[field.key] = 0.0
            else:
                values[field.key] = operation.get(field.key, "")

        elif field.source == "fixed":
            values[field.key] = manual_values.get(field.key, field.default)

        elif field.source == "manual":
            values[field.key] = manual_values.get(field.key, "")

        elif field.source == "ocr":
            values[field.key] = manual_values.get(field.key, operation.get("Libellé", ""))

        elif field.source == "computed":
            # Différé après les autres champs
            pass

    # Calculer les champs computed
    for field in tpl.fields:
        if field.source == "computed" and field.formula:
            values[field.key] = _evaluate_formula(field.formula, values)

    return values


def _evaluate_formula(formula: str, values: dict) -> Optional[float]:
    """Évalue une formule simple (+ - * /) avec les valeurs connues."""
    try:
        expr = formula
        for key, val in values.items():
            try:
                num_val = float(val) if val else 0.0
            except (ValueError, TypeError):
                num_val = 0.0
            expr = expr.replace(key, str(num_val))

        # Sécurité : n'autoriser que les opérations arithmétiques simples
        if not re.match(r"^[\d\s\.\+\-\*/\(\)]+$", expr):
            return None

        result = eval(expr)  # noqa: S307 — expression sanitisée
        return round(float(result), 2)
    except Exception:
        return None


def _generate_pdf(path: Path, vendor: str, field_values: dict) -> None:
    """Génère un PDF justificatif sobre au format A5 via ReportLab."""
    from reportlab.lib.pagesizes import A5
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors

    c = canvas.Canvas(str(path), pagesize=A5)
    width, height = A5  # 148mm x 210mm

    margin = 15 * mm
    y = height - margin

    # ── En-tête : fournisseur + date ──
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin, y, vendor)

    date_str = field_values.get("date", "")
    if date_str:
        c.setFont("Helvetica", 10)
        c.drawRightString(width - margin, y, _format_date_fr(date_str))

    y -= 8 * mm

    # Ligne séparatrice
    c.setStrokeColor(colors.Color(0.7, 0.7, 0.7))
    c.setLineWidth(0.5)
    c.line(margin, y, width - margin, y)
    y -= 8 * mm

    # ── Champs spécifiques ──
    c.setFont("Helvetica", 10)
    skip_keys = {"date", "montant_ttc", "montant_ht", "tva", "tva_rate", "fournisseur"}
    for key, val in field_values.items():
        if key in skip_keys or val is None or val == "":
            continue
        label = key.replace("_", " ").capitalize()
        c.drawString(margin, y, f"{label} : {val}")
        y -= 5 * mm

    if y < height - margin - 8 * mm - 8 * mm:
        # Il y avait des champs spécifiques, ajouter une séparation
        y -= 3 * mm
        c.line(margin, y, width - margin, y)
        y -= 8 * mm

    # ── Tableau montants ──
    col_label = margin
    col_value = width - margin

    c.setFont("Helvetica", 9)
    c.setFillColor(colors.Color(0.4, 0.4, 0.4))
    c.drawString(col_label, y, "Désignation")
    c.drawRightString(col_value, y, "Montant")
    y -= 3 * mm
    c.line(margin, y, width - margin, y)
    y -= 6 * mm

    c.setFillColor(colors.Color(0, 0, 0))
    c.setFont("Helvetica", 10)

    # Montant HT
    montant_ht = field_values.get("montant_ht")
    if montant_ht is not None:
        c.drawString(col_label, y, "Montant HT")
        c.drawRightString(col_value, y, _format_currency(montant_ht))
        y -= 5 * mm

    # TVA
    tva = field_values.get("tva")
    tva_rate = field_values.get("tva_rate", 20)
    if tva is not None:
        c.drawString(col_label, y, f"TVA ({tva_rate}%)")
        c.drawRightString(col_value, y, _format_currency(tva))
        y -= 5 * mm

    # Ligne séparatrice
    y -= 2 * mm
    c.setLineWidth(1)
    c.line(margin, y, width - margin, y)
    y -= 6 * mm

    # TOTAL TTC
    montant_ttc = field_values.get("montant_ttc")
    if montant_ttc is not None:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(col_label, y, "TOTAL TTC")
        c.drawRightString(col_value, y, _format_currency(montant_ttc))

    c.save()
    logger.info(f"PDF reconstitué généré: {path.name}")


def _format_currency(value) -> str:
    """Formate un montant en euros français : 1 234,56 EUR."""
    try:
        v = float(value)
    except (ValueError, TypeError):
        return str(value)
    # Formater avec séparateur de milliers espace et décimale virgule
    integer_part = int(abs(v))
    decimal_part = abs(v) - integer_part
    int_str = f"{integer_part:,}".replace(",", " ")
    dec_str = f"{decimal_part:.2f}"[1:]  # .XX
    sign = "-" if v < 0 else ""
    return f"{sign}{int_str}{dec_str.replace('.', ',')} \u20ac"


def _format_date_fr(date_str: str) -> str:
    """Convertit YYYY-MM-DD en DD/MM/YYYY."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%d/%m/%Y")
    except (ValueError, TypeError):
        return date_str
