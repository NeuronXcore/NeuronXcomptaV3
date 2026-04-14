"""
Router API pour les templates de justificatifs.
"""
from __future__ import annotations

import json as _json

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from backend.models.template import (
    BatchCandidatesRequest,
    BatchCandidatesResponse,
    BatchGenerateRequest,
    BatchGenerateResponse,
    BatchSuggestRequest,
    BatchSuggestResponse,
    ExtractFieldsRequest,
    GenerateRequest,
    OpsWithoutJustificatifResponse,
    TemplateCreateRequest,
)
from backend.services import template_service

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("/")
async def list_templates():
    """Liste tous les templates."""
    store = template_service.load_templates()
    return store.templates


@router.get("/ops-without-justificatif", response_model=OpsWithoutJustificatifResponse)
async def get_ops_without_justificatif(year: int = Query(...)):
    """Retourne toutes les opérations sans justificatif groupées par catégorie."""
    return template_service.get_all_ops_without_justificatif(year)


@router.post("/batch-suggest", response_model=BatchSuggestResponse)
async def batch_suggest(request: BatchSuggestRequest):
    """Groupe des opérations par meilleur template suggéré."""
    return template_service.batch_suggest_templates(
        [op.model_dump() for op in request.operations]
    )


@router.get("/ged-summary")
async def get_ged_summary():
    """Retourne la liste des templates enrichie pour la GED (comptage fac-similés)."""
    return template_service.get_ged_templates_summary()


@router.post("/from-blank")
async def create_template_from_blank(
    file: UploadFile = File(...),
    vendor: str = Form(...),
    vendor_aliases: str = Form("[]"),
    category: str = Form(""),
    sous_categorie: str = Form(""),
):
    """Crée un template depuis un PDF de fond vierge (sans OCR).

    Body multipart/form-data :
    - file : PDF obligatoire
    - vendor : str obligatoire
    - vendor_aliases : JSON array string (optionnel, défaut "[]")
    - category : str (optionnel)
    - sous_categorie : str (optionnel)
    """
    # Valider content-type
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Seuls les PDF sont acceptés")

    data = await file.read()
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Fichier non-PDF (magic bytes invalides)")

    # Parser les aliases JSON
    try:
        aliases_list = _json.loads(vendor_aliases) if vendor_aliases else []
        if not isinstance(aliases_list, list):
            aliases_list = []
        aliases_list = [str(a).strip() for a in aliases_list if str(a).strip()]
    except (ValueError, TypeError):
        aliases_list = []

    vendor_clean = vendor.strip()
    if not vendor_clean:
        raise HTTPException(status_code=400, detail="Le nom du fournisseur est obligatoire")

    try:
        tpl = template_service.create_blank_template(
            file_bytes=data,
            vendor=vendor_clean,
            vendor_aliases=aliases_list,
            category=category.strip() or None,
            sous_categorie=sous_categorie.strip() or None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur création template: {e}")

    return tpl


@router.get("/{template_id}/thumbnail")
async def get_template_thumbnail(template_id: str):
    """Retourne le thumbnail PNG d'un template blank (200px de large)."""
    tpl = template_service.get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template non trouvé")
    if not tpl.is_blank_template:
        raise HTTPException(status_code=404, detail="Thumbnail uniquement disponible pour blank templates")
    thumb = template_service.get_blank_template_thumbnail_path(template_id)
    if not thumb or not thumb.exists():
        raise HTTPException(status_code=404, detail="Thumbnail introuvable")
    return FileResponse(str(thumb), media_type="image/png")


@router.get("/{template_id}/background")
async def get_template_background(template_id: str):
    """Retourne le PDF de fond d'un blank template (pour aperçu haute résolution)."""
    tpl = template_service.get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template non trouvé")
    if not tpl.is_blank_template:
        raise HTTPException(status_code=404, detail="PDF de fond uniquement disponible pour blank templates")
    bg = template_service.get_blank_template_background_path(template_id)
    if not bg:
        raise HTTPException(status_code=404, detail="PDF de fond introuvable")
    return FileResponse(str(bg), media_type="application/pdf")


@router.get("/{template_id}/page-size")
async def get_template_page_size(template_id: str):
    """Retourne les dimensions de la page 0 (points PDF) pour click-to-position."""
    tpl = template_service.get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template non trouvé")
    return {
        "width_pt": tpl.page_width_pt,
        "height_pt": tpl.page_height_pt,
        "page": 0,
    }


@router.get("/{template_id}/ged-detail")
async def get_template_ged_detail(template_id: str):
    """Retourne le détail d'un template + ses fac-similés générés pour le drawer GED."""
    detail = template_service.get_ged_template_detail(template_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Template non trouvé")
    return detail


@router.get("/{template_id}")
async def get_template(template_id: str):
    """Retourne un template par ID."""
    tpl = template_service.get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template non trouvé")
    return tpl


@router.post("/")
async def create_template(request: TemplateCreateRequest):
    """Crée un nouveau template."""
    return template_service.create_template(request)


@router.post("/batch-candidates", response_model=BatchCandidatesResponse)
async def get_batch_candidates(request: BatchCandidatesRequest):
    """Trouve les opérations sans justificatif matchant les aliases d'un template."""
    try:
        return template_service.find_batch_candidates(request.template_id, request.year)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/batch-generate", response_model=BatchGenerateResponse)
async def batch_generate(request: BatchGenerateRequest):
    """Génère des fac-similés en batch pour les opérations sélectionnées."""
    try:
        return template_service.batch_generate(request.template_id, request.operations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{template_id}")
async def update_template(template_id: str, request: TemplateCreateRequest):
    """Met à jour un template existant."""
    tpl = template_service.update_template(template_id, request)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template non trouvé")
    return tpl


@router.delete("/{template_id}")
async def delete_template(template_id: str):
    """Supprime un template."""
    if not template_service.delete_template(template_id):
        raise HTTPException(status_code=404, detail="Template non trouvé")
    return {"success": True}


@router.post("/extract")
async def extract_fields(request: ExtractFieldsRequest):
    """Extrait les champs d'un justificatif existant pour créer un template."""
    return template_service.extract_fields_from_justificatif(request.filename)


@router.post("/generate")
async def generate_reconstitue(request: GenerateRequest):
    """Génère un PDF justificatif reconstitué."""
    try:
        return template_service.generate_reconstitue(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suggest/{operation_file}/{operation_index}")
async def suggest_templates(operation_file: str, operation_index: int):
    """Suggère des templates pour une opération donnée."""
    from backend.services import operation_service

    try:
        ops = operation_service.load_operations(operation_file)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fichier opérations non trouvé")

    if not (0 <= operation_index < len(ops)):
        raise HTTPException(status_code=400, detail="Index opération invalide")

    libelle = ops[operation_index].get("Libellé", "") or ops[operation_index].get("Libelle", "")
    return template_service.suggest_template(libelle)
