"""
Router GED (Gestion Électronique de Documents).
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse

from backend.models.ged import GedDocumentUpdate, PostesConfig
from backend.services import ged_service



router = APIRouter(prefix="/api/ged", tags=["ged"])


# ─── Tree & Documents ───

@router.get("/tree")
async def get_tree():
    metadata = ged_service.scan_all_sources()
    postes = ged_service.load_postes()
    return ged_service.build_tree(metadata, postes)


@router.get("/documents")
async def list_documents(
    type: Optional[str] = Query(None, description="releve, justificatif, rapport, document_libre"),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    categorie: Optional[str] = Query(None),
    sous_categorie: Optional[str] = Query(None),
    fournisseur: Optional[str] = Query(None),
    format_type: Optional[str] = Query(None),
    favorite: Optional[bool] = Query(None),
    poste_comptable: Optional[str] = Query(None),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    search: Optional[str] = Query(None),
    sort_by: str = Query("added_at"),
    sort_order: str = Query("desc"),
):
    metadata = ged_service.load_metadata()
    tags_list = [t.strip() for t in tags.split(",")] if tags else None
    return ged_service.get_documents(
        metadata,
        type_filter=type,
        year=year,
        month=month,
        quarter=quarter,
        categorie=categorie,
        sous_categorie=sous_categorie,
        fournisseur=fournisseur,
        format_type=format_type,
        favorite=favorite,
        poste_comptable=poste_comptable,
        tags=tags_list,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    metadata_json: str = Form("{}"),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant")

    content = await file.read()
    try:
        request = json.loads(metadata_json)
    except json.JSONDecodeError:
        request = {}

    doc = ged_service.upload_document(content, file.filename, request)

    # Hook previsionnel — check document matching
    try:
        from backend.services import previsionnel_service
        doc_id = doc.get("doc_id") or doc.get("filename") or file.filename
        previsionnel_service.check_single_document(doc_id, "ged")
    except Exception:
        pass

    return doc


@router.patch("/documents/{doc_id:path}")
async def update_document(doc_id: str, updates: GedDocumentUpdate):
    try:
        return ged_service.update_document(doc_id, updates.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/documents/{doc_id:path}")
async def delete_document(doc_id: str):
    try:
        success = ged_service.delete_document(doc_id)
        if not success:
            raise HTTPException(status_code=404, detail="Document non trouvé")
        return {"success": True, "message": "Document supprimé"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/documents/{doc_id:path}/preview")
async def preview_document(doc_id: str):
    path = ged_service.get_file_path(doc_id)
    if not path:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    import mimetypes
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)


@router.get("/documents/{doc_id:path}/thumbnail")
async def get_thumbnail(doc_id: str):
    thumb = ged_service.get_thumbnail_path(doc_id)
    if not thumb:
        raise HTTPException(status_code=404, detail="Thumbnail non disponible")
    return FileResponse(thumb, media_type="image/png")


@router.post("/documents/{doc_id:path}/open-native")
async def open_native(doc_id: str):
    success = ged_service.open_in_native_app(doc_id)
    if not success:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    return {"status": "opened"}


# ─── Types ───

@router.get("/types")
async def get_document_types():
    """Retourne les types de documents distincts pour l'autocomplétion."""
    return ged_service.get_distinct_types()


# ─── Search ───

@router.get("/search")
async def search_documents(q: str = Query("", min_length=2)):
    metadata = ged_service.load_metadata()
    return ged_service.search_fulltext(q, metadata)


# ─── Stats ───

@router.get("/stats")
async def get_stats():
    metadata = ged_service.load_metadata()
    postes = ged_service.load_postes()
    return ged_service.get_stats(metadata, postes)


# ─── Postes ───

@router.get("/postes")
async def get_postes():
    return ged_service.load_postes()


@router.put("/postes")
async def save_postes(config: PostesConfig):
    data = config.model_dump()
    ged_service.save_postes(data)
    return {"success": True, "message": "Postes sauvegardés"}


@router.post("/postes")
async def add_poste(poste: dict):
    postes_data = ged_service.load_postes()
    postes_data["postes"].append(poste)
    ged_service.save_postes(postes_data)
    return {"success": True, "message": "Poste ajouté"}


@router.delete("/postes/{poste_id}")
async def delete_poste(poste_id: str):
    postes_data = ged_service.load_postes()
    postes = postes_data["postes"]
    idx = next((i for i, p in enumerate(postes) if p["id"] == poste_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Poste non trouvé")
    if postes[idx].get("is_system", True):
        raise HTTPException(status_code=400, detail="Impossible de supprimer un poste système")
    postes.pop(idx)
    ged_service.save_postes(postes_data)
    return {"success": True, "message": "Poste supprimé"}


# ─── Bulk operations ───

@router.post("/bulk-tag")
async def bulk_tag(body: dict):
    doc_ids = body.get("doc_ids", [])
    tags = body.get("tags", [])
    metadata = ged_service.load_metadata()
    docs = metadata.get("documents", {})
    updated = 0
    for doc_id in doc_ids:
        if doc_id in docs:
            existing = set(docs[doc_id].get("tags", []))
            existing.update(tags)
            docs[doc_id]["tags"] = list(existing)
            updated += 1
    ged_service.save_metadata(metadata)
    return {"success": True, "updated": updated}


@router.post("/scan")
async def force_scan():
    metadata = ged_service.scan_all_sources()
    return {
        "success": True,
        "total_documents": len(metadata.get("documents", {})),
    }


# ─── GED V2: Rapport actions ───

@router.get("/pending-reports")
async def get_pending_reports(year: int = Query(...)):
    """Rapports mensuels non générés pour les mois passés."""
    return ged_service.get_pending_reports(year)


@router.post("/documents/{doc_id:path}/favorite")
async def toggle_favorite(doc_id: str):
    """Toggle favori sur un rapport."""
    try:
        return ged_service.toggle_rapport_favorite(doc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/documents/{doc_id:path}/regenerate")
async def regenerate_rapport(doc_id: str):
    """Re-générer un rapport avec données actualisées."""
    try:
        return ged_service.regenerate_rapport(doc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/documents/compare-reports")
async def compare_reports(body: dict = Body(...)):
    """Compare 2 rapports. Body: { doc_id_a, doc_id_b }"""
    try:
        return ged_service.compare_reports(body["doc_id_a"], body["doc_id_b"])
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
