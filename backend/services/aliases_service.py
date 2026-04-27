"""Service de gestion des aliases fournisseur → libellé bancaire.

Ces aliases servent de fallback à `score_fournisseur` du moteur de rapprochement
quand le match lexical direct (substring/Jaccard/Levenshtein) retourne 0.

Cas d'usage :
- Boulanger payé via PayPal → libellé bancaire = "PRLVSEPAPAYPALEUROPE..."
  Le mot "boulanger" n'apparaît jamais → score_fournisseur=0
  Alias "boulanger → paypal" → score_aliases=0.85 → garde-fou ne rejette plus.

Stockage : data/aliases_fournisseurs.json
Format    : {"aliases": {supplier_normalized: [pattern1, pattern2, ...]}, "_version": 1}

Auto-apprentissage : à chaque association manuelle dans `associate_manual`,
si le score_fournisseur lexical était à 0 mais que l'utilisateur a quand même
associé, on extrait un alias candidat depuis le libellé op et on l'ajoute.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Optional

from backend.core.config import DATA_DIR

logger = logging.getLogger(__name__)

ALIASES_FILE = DATA_DIR / "aliases_fournisseurs.json"
_lock = threading.Lock()
_cache: Optional[dict] = None
_cache_mtime: Optional[float] = None

# Tokens génériques à exclure du learning d'alias (préfixes bancaires SEPA, etc.)
_GENERIC_TOKENS = frozenset([
    "prlv", "prlvsepa", "sepa", "du", "cb", "vir", "virsepa", "vircpteacpteemis",
    "carte", "cheque", "remise", "frais", "interet", "epargne", "compte",
    "paiement", "achat", "retrait", "depot", "annulation", "rejete",
    "motif", "ref", "reference", "id", "tx", "ic", "fact", "facture",
    "europe", "sa", "sas", "sarl", "eurl", "etcie", "cie",
    "monsieur", "madame", "mr", "mme",
    "montauban", "paris", "toulouse", "france",  # villes courantes
])

# Score retourné par score_aliases quand un alias matche.
# Volontairement < 1.0 (match lexical direct) pour encoder un signal plus faible.
ALIAS_MATCH_SCORE = 0.85


def _normalize(text: str) -> str:
    """Normalise pour comparaison : lowercase + sans séparateurs."""
    return re.sub(r"[^\w]", "", text.lower())


def _normalize_supplier(supplier: str) -> str:
    """Normalise une clé supplier : lowercase + dashes/underscores remplacés."""
    return supplier.strip().lower().replace("_", "-")


def load() -> dict:
    """Charge les aliases (cache file-mtime). Retourne {"aliases": {...}, ...}."""
    global _cache, _cache_mtime
    with _lock:
        if not ALIASES_FILE.exists():
            return {"aliases": {}, "_version": 1}
        try:
            mtime = ALIASES_FILE.stat().st_mtime
            if _cache is not None and _cache_mtime == mtime:
                return _cache
            with open(ALIASES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return {"aliases": {}, "_version": 1}
            data.setdefault("aliases", {})
            _cache = data
            _cache_mtime = mtime
            return data
        except Exception as e:
            logger.warning(f"aliases_service.load failed: {e}")
            return {"aliases": {}, "_version": 1}


def save(data: dict) -> None:
    """Persiste la table d'aliases sur disque + invalide le cache."""
    global _cache, _cache_mtime
    with _lock:
        ALIASES_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(ALIASES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        _cache = None
        _cache_mtime = None


def get_aliases_for(supplier: str) -> list[str]:
    """Retourne la liste des patterns alias pour un supplier (lowercase normalized)."""
    if not supplier:
        return []
    data = load()
    return data.get("aliases", {}).get(_normalize_supplier(supplier), [])


def score_aliases(supplier: Optional[str], libelle: Optional[str]) -> float:
    """
    Score fallback fournisseur via aliases.

    Retourne ALIAS_MATCH_SCORE (0.85) si un alias du supplier apparaît dans
    le libellé op normalisé. Sinon 0.0.

    Cette fonction est appelée par `score_fournisseur` du rapprochement service
    UNIQUEMENT en fallback (quand substring/Jaccard/Levenshtein retournent tous 0).
    """
    if not supplier or not libelle:
        return 0.0
    aliases = get_aliases_for(supplier)
    if not aliases:
        return 0.0
    libelle_norm = _normalize(libelle)
    if not libelle_norm:
        return 0.0
    for pattern in aliases:
        pattern_norm = _normalize(pattern)
        if pattern_norm and len(pattern_norm) >= 3 and pattern_norm in libelle_norm:
            return ALIAS_MATCH_SCORE
    return 0.0


def _extract_candidate_alias(libelle: str, supplier: str) -> Optional[str]:
    """Extrait un token candidat à devenir alias depuis le libellé bancaire.

    Heuristique :
    1. Tokeniser le libellé sur les frontières alphanumériques + casse.
    2. Garder les tokens ≥ 4 caractères, alphabétiques majoritaires, non génériques.
    3. Préférer le plus long token significatif.
    4. Refuser si le supplier lui-même est dans la liste (déjà couvert par lexical match).

    Retourne le token normalisé (lowercase) ou None.
    """
    if not libelle:
        return None
    sup_norm = _normalize(supplier)

    # Découpe : sépare sur les transitions case + non-alphanumérique
    # ex: "PRLVSEPAPAYPALEUROPES.A.R.L.ETCIE" → ["PRLVSEPAPAYPALEUROPES", "A", "R", "L", "ETCIE"]
    raw_tokens = re.split(r"[^A-Za-z0-9]+", libelle)
    # Sub-tokeniser les très longs tokens majuscules collés (typique SEPA): tenter une découpe heuristique
    candidates = []
    for tok in raw_tokens:
        if not tok or len(tok) < 4:
            continue
        tok_lower = tok.lower()
        if tok_lower in _GENERIC_TOKENS:
            continue
        # Si le token contient le supplier exact, c'est déjà couvert par lexical match
        if sup_norm and sup_norm in tok_lower and len(sup_norm) >= 3:
            continue
        # Doit être à dominance alphabétique
        alpha_chars = sum(1 for c in tok if c.isalpha())
        if alpha_chars < len(tok) * 0.7:
            continue
        # Découper si très long token collé : prendre les 4-15 premiers chars alphabétiques
        # comme signature courte, ce qui correspond souvent au "fournisseur" dans SEPA
        snippet = tok_lower[:15]
        candidates.append(snippet)

    if not candidates:
        return None

    # Préférer le plus long
    candidates.sort(key=len, reverse=True)
    return candidates[0]


def learn_from_association(
    supplier: Optional[str],
    libelle: Optional[str],
    fournisseur_score: float,
) -> Optional[str]:
    """À appeler après chaque association manuelle confirmée.

    Si le score lexical était à 0 (= alias nécessaire) ET qu'on extrait un
    candidat depuis le libellé, l'ajoute à la table d'aliases.

    Retourne le pattern ajouté, ou None si rien à apprendre.
    """
    if not supplier or not libelle:
        return None
    if fournisseur_score > 0.0:
        return None  # déjà couvert par lexical match, rien à apprendre

    candidate = _extract_candidate_alias(libelle, supplier)
    if not candidate:
        return None

    sup_key = _normalize_supplier(supplier)
    data = load()
    aliases_map = data.setdefault("aliases", {})
    existing = aliases_map.setdefault(sup_key, [])
    if candidate in existing:
        return None  # déjà connu

    existing.append(candidate)
    # Persistence (ne crash pas le flow d'association si write fail)
    try:
        save(data)
        logger.info(
            f"aliases_service: learned {sup_key} → {candidate} "
            f"(libellé: {libelle[:50]!r})"
        )
        return candidate
    except Exception as e:
        logger.warning(f"aliases_service.save failed: {e}")
        return None


def list_all() -> dict[str, list[str]]:
    """Liste plate {supplier: [patterns]}."""
    return load().get("aliases", {})


def add_alias(supplier: str, pattern: str) -> bool:
    """Ajout manuel d'un alias. Retourne True si ajouté, False si déjà présent."""
    sup_key = _normalize_supplier(supplier)
    pat = pattern.strip().lower()
    if not sup_key or not pat:
        return False
    data = load()
    aliases_map = data.setdefault("aliases", {})
    existing = aliases_map.setdefault(sup_key, [])
    if pat in existing:
        return False
    existing.append(pat)
    save(data)
    return True


def remove_alias(supplier: str, pattern: str) -> bool:
    """Suppression manuelle. Retourne True si supprimé, False sinon."""
    sup_key = _normalize_supplier(supplier)
    pat = pattern.strip().lower()
    data = load()
    aliases_map = data.get("aliases", {})
    if sup_key not in aliases_map:
        return False
    if pat not in aliases_map[sup_key]:
        return False
    aliases_map[sup_key].remove(pat)
    if not aliases_map[sup_key]:
        del aliases_map[sup_key]
    save(data)
    return True
