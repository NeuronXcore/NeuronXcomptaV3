"""Tests for backend.services.justificatif_service.rename_justificatif —
focus sur la gestion des collisions cross-location (en_attente + traites)
avec distinction hash identique (dedup) vs hash différent (409)."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


@pytest.fixture
def js_module(tmp_path, monkeypatch):
    """Réimporte justificatif_service avec des dossiers temporaires isolés.

    Patch les constantes de chemins pour que les tests n'écrivent jamais dans
    les vrais dossiers de production. Retourne le module chargé."""
    en_attente = tmp_path / "en_attente"
    traites = tmp_path / "traites"
    imports = tmp_path / "imports" / "operations"
    base = tmp_path
    for d in (en_attente, traites, imports):
        d.mkdir(parents=True, exist_ok=True)

    # Force le reimport pour que les constantes capturées soient fraîches.
    sys.modules.pop("backend.services.justificatif_service", None)
    from backend.services import justificatif_service as js

    monkeypatch.setattr(js, "JUSTIFICATIFS_EN_ATTENTE_DIR", en_attente)
    monkeypatch.setattr(js, "JUSTIFICATIFS_TRAITES_DIR", traites)
    monkeypatch.setattr(js, "IMPORTS_OPERATIONS_DIR", imports)
    monkeypatch.setattr(js, "BASE_DIR", base)

    # No-ops pour les effets de bord hors scope de ces tests
    monkeypatch.setattr(js, "_update_operation_references", lambda *a, **kw: None)
    monkeypatch.setattr(js, "_update_ged_metadata_reference", lambda *a, **kw: None)
    monkeypatch.setattr(js, "_invalidate_thumbnail_for_path", lambda *a, **kw: None)
    monkeypatch.setattr(js, "invalidate_referenced_cache", lambda *a, **kw: None)

    return js, en_attente, traites


def _write_pdf(path: Path, content: bytes) -> None:
    path.write_bytes(content)


# ─── Idempotence ───────────────────────────────────────────────────────────

def test_rename_idempotent_when_same_name(js_module):
    """rename_justificatif(x, x) doit être un no-op qui retourne 200."""
    js, en_attente, _ = js_module
    _write_pdf(en_attente / "amazon_20250128_89.99.pdf", b"PDFA")

    result = js.rename_justificatif(
        "amazon_20250128_89.99.pdf", "amazon_20250128_89.99.pdf"
    )
    assert result["old"] == result["new"] == "amazon_20250128_89.99.pdf"
    assert (en_attente / "amazon_20250128_89.99.pdf").exists()


# ─── Collision hash identique → dedup ──────────────────────────────────────

def test_rename_collision_same_hash_dedups_source(js_module):
    """Cible existe avec MÊME hash que la source → supprime la source, garde la
    cible, retourne `status: deduplicated`."""
    js, en_attente, traites = js_module
    content = b"%PDF-identical-content"
    src = en_attente / "amazon_20250128_89.99_20260417_104502.pdf"
    tgt = traites / "amazon_20250128_89.99.pdf"
    _write_pdf(src, content)
    _write_pdf(tgt, content)

    result = js.rename_justificatif(src.name, tgt.name)

    assert result["status"] == "deduplicated"
    assert result["new"] == "amazon_20250128_89.99.pdf"
    assert result["location"] == "traites"
    assert not src.exists(), "source doit être supprimée"
    assert tgt.exists(), "cible doit être conservée"


# ─── Collision hash différent → 409 ────────────────────────────────────────

def test_rename_collision_different_hash_raises_409(js_module):
    """Cible existe avec hash DIFFÉRENT → lève HTTPException(409) avec detail
    structuré et suggestion de nom disponible."""
    from fastapi import HTTPException

    js, en_attente, traites = js_module
    src = en_attente / "amazon_20250128_89.99_20260417_104502.pdf"
    tgt = traites / "amazon_20250128_89.99.pdf"
    _write_pdf(src, b"%PDF-content-A")
    _write_pdf(tgt, b"%PDF-content-B-DIFFERENT")

    with pytest.raises(HTTPException) as exc:
        js.rename_justificatif(src.name, tgt.name)

    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["error"] == "rename_collision"
    assert "amazon_20250128_89.99.pdf" in detail["message"]
    assert detail["existing_location"] == "traites"
    # La suggestion doit être libre dans les 2 dossiers
    assert detail["suggestion"] != "amazon_20250128_89.99.pdf"
    assert js.get_justificatif_path(detail["suggestion"]) is None

    # Source ET cible doivent être intactes (pas de side-effect sur le 409)
    assert src.exists()
    assert tgt.exists()


# ─── Source absente → 404 ──────────────────────────────────────────────────

def test_rename_missing_source_raises_404(js_module):
    from fastapi import HTTPException

    js, _, _ = js_module
    with pytest.raises(HTTPException) as exc:
        js.rename_justificatif("nonexistent.pdf", "target.pdf")
    assert exc.value.status_code == 404
