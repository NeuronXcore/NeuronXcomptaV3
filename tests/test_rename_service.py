"""Tests for backend.services.rename_service — focus sur le durcissement
de CANONICAL_RE qui rejette les suffixes timestamp ajoutés par le sandbox."""
from __future__ import annotations

from backend.services import rename_service


# ─── Canonical regex : rejets ──────────────────────────────────────────────

def test_canonical_pattern_rejects_timestamp_suffix():
    """Cas repro : un fichier avec double timestamp dédup sandbox ne doit PAS
    être considéré canonique. Avant le fix, il tombait silencieusement dans
    `already_canonical` et n'était jamais proposé au rename."""
    assert not rename_service.is_canonical(
        "amazon_20250128_89.99_20260417_104502.pdf"
    )


def test_canonical_pattern_rejects_single_8digit_suffix():
    """Un suffix `_20260417` (8 chiffres — date compacte) doit aussi être rejeté."""
    assert not rename_service.is_canonical("amazon_20250128_89.99_20260417.pdf")


def test_canonical_pattern_rejects_6digit_suffix():
    """Un suffix `_104502` (6 chiffres — HHMMSS) doit être rejeté."""
    assert not rename_service.is_canonical("amazon_20250128_89.99_104502.pdf")


def test_canonical_pattern_rejects_3digit_suffix():
    """Le seuil dédup est `_2`..`_99` ; 3 chiffres (`_100`) est rejeté."""
    assert not rename_service.is_canonical("foo_20250101_10.00_100.pdf")


# ─── Canonical regex : acceptations ────────────────────────────────────────

def test_canonical_pattern_accepts_fs_a_2_suffixes():
    """Suffixes légitimes : `_fs` (fac-similé), `_a`/`_b` (ventilation),
    `_2`..`_99` (dédup)."""
    legitimate = [
        "amazon_20250128_89.99.pdf",
        "auchan_20250315_87.81_fs.pdf",
        "boulanger_20251130_2789.00_a.pdf",
        "boulanger_20251130_2789.00_ab.pdf",
        "foo_20250101_10.00_2.pdf",
        "foo_20250101_10.00_99.pdf",
        "foo_20250101_10.00_fs_2.pdf",
        "foo_20250101_10.00_a_3.pdf",
    ]
    for name in legitimate:
        assert rename_service.is_canonical(name), f"{name} should be canonical"


# ─── Pseudo-canonical detection ────────────────────────────────────────────

def test_legacy_pseudo_canonical_detection():
    """`is_legacy_pseudo_canonical` renvoie True uniquement pour les fichiers
    qui passaient l'ancienne regex permissive ET échouent la nouvelle."""
    # Pseudo-canoniques : matchent l'ancienne regex, pas la nouvelle
    assert rename_service.is_legacy_pseudo_canonical(
        "amazon_20250128_89.99_20260417_104502.pdf"
    )
    assert rename_service.is_legacy_pseudo_canonical(
        "amazon_20250128_89.99_20260417.pdf"
    )

    # Canoniques stricts : pas pseudo
    assert not rename_service.is_legacy_pseudo_canonical("amazon_20250128_89.99.pdf")
    assert not rename_service.is_legacy_pseudo_canonical(
        "auchan_20250315_87.81_fs.pdf"
    )

    # Totalement non-conformes : pas pseudo (ni ancienne ni nouvelle)
    assert not rename_service.is_legacy_pseudo_canonical("random_file.pdf")
    assert not rename_service.is_legacy_pseudo_canonical("IMG_20250101.pdf")
