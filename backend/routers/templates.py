"""
Router API pour les templates de justificatifs.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

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
