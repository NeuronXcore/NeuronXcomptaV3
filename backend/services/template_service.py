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
    BatchCandidate,
    BatchCandidatesResponse,
    BatchGenerateResponse,
    BatchGenerateResult,
    BatchSuggestGroup,
    BatchSuggestResponse,
    FieldCoordinates,
    GenerateRequest,
    JustificatifTemplate,
    OpsGroup,
    OpsWithoutJustificatifResponse,
    TemplateCreateRequest,
    TemplateField,
    TemplateStore,
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

    # Note: pas de champs TVA (non assujetti à la TVA)

    # Enrichir avec les coordonnées PDF si possible
    _enrich_field_coordinates(fields, pdf_path)

    return {
        "vendor": vendor,
        "suggested_aliases": aliases,
        "detected_fields": fields,
    }


def _enrich_field_coordinates(fields: list[dict], pdf_path: Path) -> None:
    """Localise les coordonnées des champs date et montant dans le PDF source via pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        return

    try:
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                words = page.extract_words(keep_blank_chars=True, extra_attrs=["fontname", "size"])
                if not words:
                    continue
                for field in fields:
                    if field.get("coordinates"):
                        continue  # déjà trouvé
                    value = str(field.get("value", "")).strip()
                    if not value:
                        continue
                    coords = _match_value_in_words(value, words, field["key"])
                    if coords:
                        field["coordinates"] = {
                            "x": coords[0],
                            "y": coords[1],
                            "w": coords[2],
                            "h": coords[3],
                            "page": page_idx,
                        }
    except Exception as e:
        logger.warning(f"Erreur localisation coordonnées PDF: {e}")


def _match_value_in_words(value: str, words: list[dict], field_key: str) -> Optional[tuple]:
    """Cherche une valeur dans les mots extraits du PDF et retourne (x, y, w, h) ou None.
    Coordonnées en points PDF, origine en haut-gauche (pdfplumber convention)."""
    # Normaliser la valeur recherchée
    search_variants = [value]

    if field_key == "montant_ttc":
        # Chercher différents formats : 188.95, 188,95, 188.95€, etc.
        try:
            num = float(value.replace(",", "."))
            search_variants = [
                f"{num:.2f}",
                f"{num:.2f}".replace(".", ","),
                f"{num:,.2f}".replace(",", " ").replace(".", ","),
                str(int(num)) if num == int(num) else "",
            ]
            search_variants = [v for v in search_variants if v]
        except (ValueError, TypeError):
            pass

    if field_key == "date":
        # Chercher différents formats de date
        try:
            from datetime import datetime as _dt
            for fmt_in in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
                try:
                    dt = _dt.strptime(value, fmt_in)
                    search_variants = [
                        dt.strftime("%d/%m/%Y"),
                        dt.strftime("%d/%m/%y"),
                        dt.strftime("%d-%m-%Y"),
                        dt.strftime("%d %m %Y"),
                        value,
                    ]
                    break
                except ValueError:
                    continue
        except Exception:
            pass

    for variant in search_variants:
        if not variant:
            continue
        # Chercher un mot exact ou une séquence de mots consécutifs
        variant_clean = variant.strip()
        for w in words:
            word_text = w.get("text", "").strip()
            if variant_clean in word_text or word_text in variant_clean:
                x0 = w["x0"]
                top = w["top"]
                x1 = w["x1"]
                bottom = w["bottom"]
                # Ajouter une petite marge
                margin = 2
                return (x0 - margin, top - margin, (x1 - x0) + margin * 2, (bottom - top) + margin * 2)

    return None


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


def _suggest_by_category(op: dict) -> Optional[JustificatifTemplate]:
    """Cherche un template par match catégorie/sous-catégorie de l'opération."""
    store = load_templates()
    cat = (op.get("Catégorie") or op.get("Categorie") or "").strip().lower()
    sub = (op.get("Sous-catégorie") or op.get("Sous-categorie") or "").strip().lower()
    if not cat:
        return None

    best_tpl = None
    best_score = 0
    for tpl in store.templates:
        tpl_cat = (tpl.category or "").strip().lower()
        tpl_sub = (tpl.sous_categorie or "").strip().lower()
        if tpl_cat and tpl_cat == cat:
            score = 2 if (tpl_sub and sub and tpl_sub == sub) else 1
            if score > best_score:
                best_score = score
                best_tpl = tpl
    return best_tpl


def batch_suggest_templates(operations: list[dict]) -> BatchSuggestResponse:
    """Groupe une liste d'opérations par meilleur template suggéré.

    Stratégie de matching (par priorité) :
    1. Catégorie + sous-catégorie du template == catégorie/sous-catégorie de l'opération
    2. Alias fournisseur dans le libellé (suggest_template existant)
    3. Sinon → unmatched
    """
    from backend.services import operation_service

    ops_cache: dict[str, list] = {}
    groups_map: dict[str, BatchSuggestGroup] = {}
    unmatched: list[dict] = []

    for item in operations:
        op_file = item.get("operation_file") or item.get("operation_file", "")
        op_index = item.get("operation_index", 0)

        if op_file not in ops_cache:
            try:
                ops_cache[op_file] = operation_service.load_operations(op_file)
            except FileNotFoundError:
                unmatched.append({"operation_file": op_file, "operation_index": op_index, "libelle": "", "error": "file_not_found"})
                continue

        file_ops = ops_cache[op_file]
        if not (0 <= op_index < len(file_ops)):
            unmatched.append({"operation_file": op_file, "operation_index": op_index, "libelle": "", "error": "invalid_index"})
            continue

        op = file_ops[op_index]
        libelle = op.get("Libellé", "") or op.get("Libelle", "")

        # 1) Match par catégorie/sous-catégorie
        matched_tpl = _suggest_by_category(op)

        # 2) Fallback : match par alias fournisseur dans le libellé
        if not matched_tpl:
            alias_suggestions = suggest_template(libelle)
            if alias_suggestions:
                tpl = get_template(alias_suggestions[0].template_id)
                if tpl:
                    matched_tpl = tpl

        if matched_tpl:
            if matched_tpl.id not in groups_map:
                groups_map[matched_tpl.id] = BatchSuggestGroup(
                    template_id=matched_tpl.id,
                    template_vendor=matched_tpl.vendor,
                    operations=[],
                )
            groups_map[matched_tpl.id].operations.append({
                "operation_file": op_file,
                "operation_index": op_index,
                "libelle": libelle,
            })
        else:
            unmatched.append({
                "operation_file": op_file,
                "operation_index": op_index,
                "libelle": libelle,
            })

    return BatchSuggestResponse(
        groups=list(groups_map.values()),
        unmatched=unmatched,
    )


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

    # Tenter le fac-similé si le template a un source_justificatif avec coordonnées
    source_pdf = _find_justificatif(tpl.source_justificatif) if tpl.source_justificatif else None
    fields_with_coords = [f for f in tpl.fields if f.coordinates] if source_pdf else []
    if source_pdf and fields_with_coords:
        try:
            _generate_pdf_facsimile(pdf_path, source_pdf, field_values, fields_with_coords)
        except Exception as e:
            logger.warning(f"Fac-similé échoué, fallback ReportLab: {e}")
            _generate_pdf(pdf_path, tpl.vendor, field_values)
    else:
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


def _blank_embedded_images(c, source_pdf_path: Path, page_idx: int, page_height: float) -> None:
    """Masque les images embarquées (photos produits) dans le PDF source avec des rectangles blancs."""
    try:
        import pdfplumber
        from reportlab.lib import colors

        with pdfplumber.open(str(source_pdf_path)) as pdf:
            if page_idx >= len(pdf.pages):
                return
            page = pdf.pages[page_idx]
            page_w = float(page.width)
            page_h = float(page.height)

            for img in (page.images or []):
                x0 = float(img.get("x0", 0))
                top = float(img.get("top", 0))
                x1 = float(img.get("x1", x0))
                bottom = float(img.get("bottom", top))
                w = x1 - x0
                h = bottom - top

                # Ignorer les images très petites (icônes, puces) et très larges (fond de page)
                if w < 20 or h < 20:
                    continue
                if w > page_w * 0.95 and h > page_h * 0.95:
                    continue

                # Convertir : pdfplumber top→ ReportLab bottom-left
                y_bottom = page_height - bottom
                margin = 2
                c.setFillColor(colors.white)
                c.setStrokeColor(colors.white)
                c.rect(x0 - margin, y_bottom - margin, w + margin * 2, h + margin * 2, fill=1, stroke=1)

    except Exception as e:
        logger.debug(f"Masquage images échoué: {e}")


def _generate_pdf_facsimile(
    path: Path,
    source_pdf_path: Path,
    field_values: dict,
    fields_with_coords: list,
) -> None:
    """Génère un fac-similé : image du PDF source + remplacement date/montant."""
    from pdf2image import convert_from_path
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    import io
    from PIL import Image as PILImage

    # 1. Convertir le PDF source en image(s) haute résolution
    dpi = 200
    images = convert_from_path(str(source_pdf_path), dpi=dpi)
    if not images:
        raise ValueError("Impossible de convertir le PDF source en image")

    # 2. Créer le canvas aux mêmes dimensions que la première page
    first_img = images[0]
    page_width_pt = first_img.width * 72.0 / dpi
    page_height_pt = first_img.height * 72.0 / dpi

    c = canvas.Canvas(str(path), pagesize=(page_width_pt, page_height_pt))

    for page_idx, img in enumerate(images):
        if page_idx > 0:
            c.showPage()
            pw = img.width * 72.0 / dpi
            ph = img.height * 72.0 / dpi
            c.setPageSize((pw, ph))
        else:
            pw = page_width_pt
            ph = page_height_pt

        # 3. Dessiner l'image source comme fond pleine page
        img_buffer = io.BytesIO()
        img.save(img_buffer, format="PNG")
        img_buffer.seek(0)
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(img_buffer), 0, 0, width=pw, height=ph)

        # 3b. Masquer les images embarquées (photos produits, logos secondaires)
        # Désactivé : le masquage efface des zones utiles sur les tickets scannés.
        # Les rectangles blancs aux coordonnées des champs (étape 4) suffisent.
        # _blank_embedded_images(c, source_pdf_path, page_idx, ph)

        # 4. Appliquer les remplacements sur cette page
        scale = 72.0 / dpi  # ne pas re-scaler, les coordonnées pdfplumber sont en pts
        for field in fields_with_coords:
            coords = field.coordinates
            if coords.page != page_idx:
                continue

            field_key = field.key
            new_value = field_values.get(field_key, "")
            if new_value is None or new_value == "":
                continue

            # pdfplumber: origine en haut-gauche. ReportLab: origine en bas-gauche.
            x = coords.x
            y_top = coords.y  # distance depuis le haut
            w = coords.w
            h = coords.h
            y_bottom = ph - y_top - h  # convertir en bas-gauche

            # b. Préparer la nouvelle valeur formatée
            font_size = min(h * 0.8, 11)
            actual_font_size = max(font_size, 7)
            c.setFont("Helvetica", actual_font_size)

            formatted = str(new_value)
            if field_key == "montant_ttc":
                formatted = _format_currency(new_value)
            elif field_key == "date":
                formatted = _format_date_fr(str(new_value))

            # a. Rectangle blanc — élargi pour couvrir l'ancien texte + le nouveau
            pad_h = 2  # padding vertical
            pad_w = 4  # padding horizontal
            text_width = c.stringWidth(formatted, "Helvetica", actual_font_size)
            rect_w = max(w, text_width + pad_w * 2)  # au moins aussi large que le texte
            c.setFillColor(colors.white)
            c.setStrokeColor(colors.white)
            c.rect(x - pad_w, y_bottom - pad_h, rect_w + pad_w, h + pad_h * 2, fill=1, stroke=1)

            # c. Écrire la nouvelle valeur
            c.setFillColor(colors.black)
            c.setFont("Helvetica", actual_font_size)

            # Centrer verticalement dans la zone
            text_y = y_bottom + (h - actual_font_size) / 2
            c.drawString(x + 1, text_y, formatted)

    c.save()
    logger.info(f"PDF fac-similé généré: {path.name} (source: {source_pdf_path.name})")


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


# ──── Batch ────


def _matches_aliases(libelle: str, aliases: list[str]) -> bool:
    """Vérifie si le libellé matche au moins un alias (sous-chaîne, case-insensitive)."""
    libelle_lower = libelle.lower()
    return any(alias.lower() in libelle_lower for alias in aliases)


def _op_has_no_justificatif(op: dict) -> bool:
    """Vérifie qu'une opération n'a PAS de justificatif."""
    justif = op.get("Justificatif")
    lien = op.get("Lien justificatif", "") or ""
    return (not justif) and (not lien.strip())


def _extract_montant(op: dict) -> float:
    """Extrait le montant (débit ou crédit) en valeur absolue."""
    debit = op.get("Débit") or op.get("Debit") or 0
    credit = op.get("Crédit") or op.get("Credit") or 0
    try:
        debit = float(debit) if debit else 0
        credit = float(credit) if credit else 0
    except (ValueError, TypeError):
        debit, credit = 0, 0
    return abs(debit) if debit else abs(credit)


def _extract_mois(date_str: str) -> int:
    """Extrait le mois (1-12) d'une date YYYY-MM-DD."""
    try:
        return int(date_str.split("-")[1])
    except (IndexError, ValueError):
        return 0


def _op_matches_category(op: dict, category: str, sous_categorie: str) -> bool:
    """Vérifie si l'opération correspond à la catégorie/sous-catégorie du template."""
    op_cat = (op.get("Catégorie") or op.get("Categorie") or "").strip()
    if not op_cat:
        return False
    if op_cat.lower() != category.lower():
        return False
    if sous_categorie:
        op_sub = (op.get("Sous-catégorie") or op.get("Sous-categorie") or "").strip()
        if op_sub.lower() != sous_categorie.lower():
            return False
    return True


def find_batch_candidates(template_id: str, year: int) -> BatchCandidatesResponse:
    """Trouve toutes les opérations sans justificatif matchant le template.

    Filtre en priorité par catégorie/sous-catégorie du template (si définies),
    puis par aliases fournisseur en complément.
    """
    from backend.services import operation_service

    tpl = get_template(template_id)
    if not tpl:
        raise ValueError(f"Template non trouvé: {template_id}")

    aliases = tpl.vendor_aliases
    tpl_category = (tpl.category or "").strip()
    tpl_sous_cat = (tpl.sous_categorie or "").strip()

    if not aliases and not tpl_category:
        return BatchCandidatesResponse(
            template_id=template_id, vendor=tpl.vendor, year=year,
            candidates=[], total=0,
        )

    op_files = operation_service.list_operation_files()
    candidates: list[BatchCandidate] = []

    for fmeta in op_files:
        file_year = fmeta.get("year")
        if file_year and int(file_year) != year:
            continue
        filename = fmeta["filename"]
        try:
            ops = operation_service.load_operations(filename)
        except Exception:
            continue

        for idx, op in enumerate(ops):
            libelle = op.get("Libellé", "") or op.get("Libelle", "") or ""
            ventilation = op.get("ventilation") or []

            # Déterminer si l'opération matche le template :
            # 1) Par catégorie/sous-catégorie (prioritaire si définies sur le template)
            # 2) Par aliases fournisseur (fallback ou complément)
            matches_cat = tpl_category and _op_matches_category(op, tpl_category, tpl_sous_cat)
            matches_alias = aliases and _matches_aliases(libelle, aliases)

            # Si le template a une catégorie, on filtre par catégorie en priorité
            # Sinon on utilise les aliases uniquement
            if tpl_category:
                if not matches_cat:
                    continue
            else:
                if not matches_alias:
                    continue

            op_cat = (op.get("Catégorie") or op.get("Categorie") or "").strip()
            op_sub = (op.get("Sous-catégorie") or op.get("Sous-categorie") or "").strip()

            if ventilation:
                for v_idx, v_line in enumerate(ventilation):
                    v_justif = v_line.get("Justificatif")
                    v_lien = v_line.get("Lien justificatif", "") or ""
                    if v_justif or (v_lien and v_lien.strip()):
                        continue
                    v_montant = 0.0
                    try:
                        v_montant = abs(float(v_line.get("montant", 0) or 0))
                    except (ValueError, TypeError):
                        pass
                    v_cat = (v_line.get("categorie") or op_cat).strip()
                    v_sub = (v_line.get("sous_categorie") or op_sub).strip()
                    date_str = op.get("Date", "") or ""
                    candidates.append(BatchCandidate(
                        operation_file=filename,
                        operation_index=idx,
                        date=date_str,
                        libelle=libelle[:100],
                        montant=v_montant,
                        mois=_extract_mois(date_str),
                        categorie=v_cat,
                        sous_categorie=v_sub,
                    ))
            else:
                if not _op_has_no_justificatif(op):
                    continue
                date_str = op.get("Date", "") or ""
                candidates.append(BatchCandidate(
                    operation_file=filename,
                    operation_index=idx,
                    date=date_str,
                    libelle=libelle[:100],
                    montant=_extract_montant(op),
                    mois=_extract_mois(date_str),
                    categorie=op_cat,
                    sous_categorie=op_sub,
                ))

    # Trier par date croissante
    candidates.sort(key=lambda c: c.date)

    return BatchCandidatesResponse(
        template_id=template_id,
        vendor=tpl.vendor,
        year=year,
        candidates=candidates,
        total=len(candidates),
    )


def batch_generate(template_id: str, operations: list[dict]) -> BatchGenerateResponse:
    """Génère des fac-similés en batch pour une liste d'opérations."""
    import time

    results: list[BatchGenerateResult] = []
    generated = 0
    errors = 0

    for i, op_ref in enumerate(operations):
        op_file = op_ref.get("operation_file", "")
        op_index = op_ref.get("operation_index", 0)

        try:
            request = GenerateRequest(
                template_id=template_id,
                operation_file=op_file,
                operation_index=op_index,
                field_values={},
                auto_associate=True,
            )
            result = generate_reconstitue(request)
            results.append(BatchGenerateResult(
                operation_file=op_file,
                operation_index=op_index,
                filename=result.get("filename"),
                associated=result.get("associated", False),
            ))
            generated += 1
        except Exception as e:
            logger.error(f"Batch generate erreur [{op_file}:{op_index}]: {e}")
            results.append(BatchGenerateResult(
                operation_file=op_file,
                operation_index=op_index,
                error=str(e),
            ))
            errors += 1

        # Pause pour éviter les collisions de timestamp
        if i < len(operations) - 1:
            time.sleep(0.1)

    return BatchGenerateResponse(
        generated=generated,
        errors=errors,
        total=len(operations),
        results=results,
    )


def get_all_ops_without_justificatif(year: int) -> OpsWithoutJustificatifResponse:
    """Retourne toutes les opérations sans justificatif pour une année, groupées par catégorie."""
    from backend.services import operation_service

    op_files = operation_service.list_operation_files()
    groups_map: dict[tuple[str, str], list[BatchCandidate]] = {}

    for fmeta in op_files:
        file_year = fmeta.get("year")
        if file_year and int(file_year) != year:
            continue
        filename = fmeta["filename"]
        try:
            ops = operation_service.load_operations(filename)
        except Exception:
            continue

        for idx, op in enumerate(ops):
            ventilation = op.get("ventilation") or []
            if ventilation:
                for v_line in ventilation:
                    v_justif = v_line.get("Justificatif")
                    v_lien = v_line.get("Lien justificatif", "") or ""
                    if v_justif or (v_lien and v_lien.strip()):
                        continue
                    v_cat = (v_line.get("categorie") or op.get("Catégorie") or op.get("Categorie") or "").strip()
                    v_sub = (v_line.get("sous_categorie") or op.get("Sous-catégorie") or op.get("Sous-categorie") or "").strip()
                    cat = v_cat or "Sans catégorie"
                    sub = v_sub
                    v_montant = 0.0
                    try:
                        v_montant = abs(float(v_line.get("montant", 0) or 0))
                    except (ValueError, TypeError):
                        pass
                    date_str = op.get("Date", "") or ""
                    libelle = op.get("Libellé", "") or op.get("Libelle", "") or ""
                    key = (cat, sub)
                    groups_map.setdefault(key, []).append(BatchCandidate(
                        operation_file=filename, operation_index=idx,
                        date=date_str, libelle=libelle[:100],
                        montant=v_montant, mois=_extract_mois(date_str),
                        categorie=cat, sous_categorie=sub,
                    ))
            else:
                if not _op_has_no_justificatif(op):
                    continue
                cat = (op.get("Catégorie") or op.get("Categorie") or "").strip() or "Sans catégorie"
                sub = (op.get("Sous-catégorie") or op.get("Sous-categorie") or "").strip()
                date_str = op.get("Date", "") or ""
                libelle = op.get("Libellé", "") or op.get("Libelle", "") or ""
                key = (cat, sub)
                groups_map.setdefault(key, []).append(BatchCandidate(
                    operation_file=filename, operation_index=idx,
                    date=date_str, libelle=libelle[:100],
                    montant=_extract_montant(op), mois=_extract_mois(date_str),
                    categorie=cat, sous_categorie=sub,
                ))

    # Construire les groupes avec auto-suggestion template
    groups: list[OpsGroup] = []
    for (cat, sub), ops_list in sorted(groups_map.items()):
        ops_list.sort(key=lambda c: c.date)
        # Auto-suggestion : chercher un template matchant par catégorie/sous-catégorie
        suggested_id = None
        suggested_vendor = None
        store = load_templates()
        best_score = 0
        for tpl in store.templates:
            tpl_cat = (tpl.category or "").strip()
            tpl_sub = (tpl.sous_categorie or "").strip()
            if tpl_cat and tpl_cat.lower() == cat.lower():
                # Match exact catégorie + sous-catégorie = score 2
                # Match catégorie seule = score 1
                score = 2 if (tpl_sub and sub and tpl_sub.lower() == sub.lower()) else 1
                if score > best_score:
                    best_score = score
                    suggested_id = tpl.id
                    suggested_vendor = tpl.vendor
        # Fallback : suggestion par alias sur le premier libellé
        if not suggested_id and ops_list:
            suggestions = suggest_template(ops_list[0].libelle)
            if suggestions:
                suggested_id = suggestions[0].template_id
                suggested_vendor = suggestions[0].vendor

        groups.append(OpsGroup(
            category=cat, sous_categorie=sub,
            count=len(ops_list),
            total_montant=round(sum(o.montant for o in ops_list), 2),
            suggested_template_id=suggested_id,
            suggested_template_vendor=suggested_vendor,
            operations=ops_list,
        ))

    return OpsWithoutJustificatifResponse(
        year=year,
        total=sum(g.count for g in groups),
        groups=groups,
    )
