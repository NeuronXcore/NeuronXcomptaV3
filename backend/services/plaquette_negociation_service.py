"""Service de négociation — Position de repli (Session 40 P1).

Pour chaque item de la plaquette en statut `a_challenger`, calcule :
  - une **position de repli** (% de l'écart à maintenir, 0-100)
  - un **ton** (ferme / équilibré / conciliant) inféré du score de force
  - un **texte d'argumentation** rédigé via templates par catégorie

Logique de scoring `force_score ∈ [0..1]` :
    base 0.5
    + risque inversé (faible +0.25 / modéré 0 / élevé −0.20 / critique −0.35)
    + boi_cgi_cité +0.20
    + pieces_disponibles non vides +0.15
    + statut_resolu/refus_justifie +0.10
    + forfait/quote-part appliqué +0.10
    − montant_eleve_sensible −0.10
    − taux_justif_bas −0.05

Mapping force_score → pct_maintenu (recommandation auto) :
    >= 0.80 → 100 %  (position forte, on tient bon)
    >= 0.60 → 75 %   (concession légère)
    >= 0.40 → 50 %   (équilibré)
    >= 0.20 → 25 %   (concession majoritaire)
    sinon  → 0 %     (abandon, signal de bonne foi)

Mapping force_score → tone :
    >= 0.65 → ferme
    >= 0.35 → equilibre
    sinon  → conciliant

Le **niveau CRITIQUE de risque** vient automatiquement avec une concession
profonde — l'algo ne le force pas, le mapping risque inversé le fait naturellement.

Persistance : `item.concession` dans le JSON `data/plaquette_check/{year}.json`.
Auto-recompute appelé depuis `plaquette_service.get_or_create` / `get` après
`evaluate_all_items` (risque). Skip si statut == DECLARE OU `source == "manual"`.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional

from backend.models.plaquette_check import (
    ConcessionTone,
    PlaquetteCheckStatus,
    RisqueNiveau,
)

logger = logging.getLogger(__name__)


# ─── Constantes scoring ───

_THRESHOLDS_PCT: list[tuple[float, float]] = [
    (0.80, 100.0),
    (0.60, 75.0),
    (0.40, 50.0),
    (0.20, 25.0),
    (0.0, 0.0),
]

_THRESHOLDS_TONE: list[tuple[float, ConcessionTone]] = [
    (0.65, "ferme"),
    (0.35, "equilibre"),
    (0.0, "conciliant"),
]

_RISQUE_DELTA: dict[str, float] = {
    "faible": +0.25,
    "modere": 0.0,
    "eleve": -0.20,
    "critique": -0.35,
}


# ─── Helpers ───


def _now_iso() -> str:
    return datetime.now().isoformat()


def _format_eur_fr(amount: Optional[float], signed: bool = False) -> str:
    """Format FR : '1 234,56 €' / signé : '+1 234,56 €' ou '−1 234,56 €'."""
    if amount is None:
        return "—"
    a = abs(float(amount))
    s = f"{a:,.2f}".replace(",", " ").replace(".", ",")
    if signed:
        sign = "−" if amount < 0 else "+"
        return f"{sign}{s} €"
    sign = "-" if amount < 0 else ""
    return f"{sign}{s} €"


def _round_pct(pct: float) -> int:
    """Arrondit le pourcentage pour l'affichage (entier)."""
    return int(round(pct))


# ─── Templates d'argumentation par catégorie ───

# Variables interpolables :
#   {libelle}, {ecart_signed_fr}, {montant_maintenu_fr}, {montant_concede_fr},
#   {pct_maintenu}, {category_label}, {boi_title}, {boi_url}, {justif_mention}

_TEMPLATES_BY_CATEGORY: dict[str, dict[ConcessionTone, str]] = {
    "forfait_repas": {
        "ferme": (
            "Sur la ligne **{libelle}** (écart {ecart_signed_fr}), je maintiens "
            "**{pct_maintenu} %** soit **{montant_maintenu_fr}**. Le forfait BOI-BNC-BASE-40-60-§50 "
            "(plafond restaurant 20,20 € − seuil maison 5,35 € = 14,85 €/jour en 2025) "
            "s'applique sur les jours travaillés effectifs et est documenté dans le "
            "rapport joint. L'éloignement domicile-cabinet justifie la déduction "
            "({justif_mention})."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** soit **{montant_maintenu_fr}** et de concéder "
            "**{montant_concede_fr}**. Le forfait BOI-BNC-BASE-40-60 s'applique par "
            "défaut sur les jours travaillés mais je peux affiner si tu as un "
            "décompte différent."
        ),
        "conciliant": (
            "Pour **{libelle}**, je m'aligne sur ta position : concession à "
            "**{montant_concede_fr}** (maintien {pct_maintenu} %). Le forfait restera "
            "applicable au prochain exercice si je documente mieux l'éloignement."
        ),
    },
    "immobilisations": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), je rappelle que le seuil "
            "d'immobilisation est fixé à 500 € HT par bien (art. 38 sexies annexe III "
            "CGI + BOI-BIC-CHG-20-30-30-§40). Les acquisitions concernées sont "
            "individuellement sous ce seuil et donc déductibles en charges immédiates. "
            "**Je maintiens {pct_maintenu} % soit {montant_maintenu_fr}** ({justif_mention})."
        ),
        "equilibre": (
            "Concernant les acquisitions sur **{libelle}** ({ecart_signed_fr}), une "
            "partie peut effectivement relever de l'amortissement. **Je propose de "
            "retenir {montant_maintenu_fr} en charges immédiates** ({pct_maintenu} %) "
            "et d'inscrire le solde au registre des immobilisations."
        ),
        "conciliant": (
            "Pour **{libelle}**, je te suis sur le principe d'amortissement. **Je "
            "propose de retenir {montant_maintenu_fr}** seulement en déduction immédiate "
            "et de porter {montant_concede_fr} au registre."
        ),
    },
    "honoraires_retrocedes": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), les honoraires rétrocédés sont "
            "déductibles dès lors qu'ils sont déclarés DAS-2 conformément à "
            "l'article 240 CGI + BOI-BNC-DECLA-10-30 (seuil 1 200 € par bénéficiaire). "
            "Les bénéficiaires sont documentés ({justif_mention}). **Je maintiens "
            "{pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) sous réserve de joindre "
            "la DAS-2 correspondante. Concession {montant_concede_fr} sur le solde "
            "en attente de pièces complémentaires."
        ),
        "conciliant": (
            "Pour **{libelle}**, je propose de retenir **{montant_maintenu_fr}** "
            "({pct_maintenu} %) dans l'attente d'un échange sur les bénéficiaires "
            "exacts. Concession à {montant_concede_fr}."
        ),
    },
    "quote_part_vehicule": {
        "ferme": (
            "L'écart sur **{libelle}** ({ecart_signed_fr}) résulte de l'application "
            "stricte de la quote-part professionnelle (BOI-BNC-BASE-40-60-40 + "
            "art. 39-4° CGI). Le calcul kilométrique est documenté dans le rapport joint "
            "(distance domicile-cabinet × trajets + km supplémentaires pro / total annuel). "
            "**Je maintiens {pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) en m'appuyant sur le ratio "
            "annuel appliqué. Concession {montant_concede_fr} pour clore ce point sans contentieux."
        ),
        "conciliant": (
            "Pour **{libelle}**, je m'aligne : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Le ratio véhicule pourra être affiné l'an prochain "
            "avec un carnet de bord plus détaillé."
        ),
    },
    "csg_crds_split": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), la part CSG déductible est calculée "
            "selon l'article 154 quinquies CGI + décret 2024-688 (assiette BNC × 74 % "
            "à compter de 2025 × 6,8 %). Le calcul est cohérent avec la liasse SCP "
            "({justif_mention}). **Je maintiens {pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant la CSG déductible **{libelle}** ({ecart_signed_fr}), je "
            "propose de maintenir **{pct_maintenu} %** ({montant_maintenu_fr}) selon "
            "l'assiette unifiée 2025. Concession {montant_concede_fr} sur la base de calcul."
        ),
        "conciliant": (
            "Pour **{libelle}**, je suis ouvert : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Le détail de l'assiette CSG sera précisé "
            "à ta demande."
        ),
    },
    "urssaf_split": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), les cotisations URSSAF (hors CSG) "
            "sont déductibles intégralement. Le détail (acomptes vs régularisation) est "
            "documenté dans le rapport joint ({justif_mention}). **Je maintiens "
            "{pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) sous réserve de la "
            "régularisation N-1. Concession {montant_concede_fr} sur les variations "
            "de paiement infra-annuelles."
        ),
        "conciliant": (
            "Pour **{libelle}**, je te suis : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Le rapprochement précis URSSAF pourra être affiné."
        ),
    },
    "dotations_amort": {
        "ferme": (
            "L'écart sur **{libelle}** ({ecart_signed_fr}) résulte du registre des "
            "immobilisations avec plan d'amortissement nominatif (art. 39-1-2° CGI + "
            "PCG 214-13). Chaque immo est documentée (date acquisition, base, durée, "
            "mode linéaire). **Je maintiens {pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) sur la base du registre. "
            "Concession {montant_concede_fr} si une immo doit être révisée."
        ),
        "conciliant": (
            "Pour **{libelle}**, je suis ouvert : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Les calculs de dotation pourront être "
            "revérifiés au cas par cas."
        ),
    },
    "blanchissage": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), le forfait blanchissage "
            "(BOI-BNC-BASE-40-20) s'applique sur les jours travaillés × tarif pressing "
            "× décote 30 % domicile. Le décompte est fourni en annexe ({justif_mention}). "
            "**Je maintiens {pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant le forfait blanchissage **{libelle}** ({ecart_signed_fr}), "
            "je propose de maintenir **{pct_maintenu} %** ({montant_maintenu_fr}) "
            "selon le barème pressing. Concession {montant_concede_fr} sur les "
            "quantités estimées."
        ),
        "conciliant": (
            "Pour **{libelle}**, je m'aligne : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Le barème blanchissage pourra être réajusté."
        ),
    },
    "pieces_justificatives": {
        "ferme": (
            "L'écart sur **{libelle}** ({ecart_signed_fr}) est documenté par les "
            "pièces probantes exigées par l'article 93 CGI + BOI-BNC-BASE-40-10-§20 "
            "({justif_mention}). **Je maintiens {pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) sous réserve de complément "
            "documentaire ({justif_mention}). Concession {montant_concede_fr}."
        ),
        "conciliant": (
            "Pour **{libelle}**, je suis ouvert : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Je transmets les pièces complémentaires sur demande."
        ),
    },
    "cadeaux_reception": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), la tolérance fiscale sur les "
            "cadeaux clients/confrères (≤ 73 € TTC par bénéficiaire) est respectée "
            "et les bénéficiaires sont identifiés ({justif_mention}). **Je maintiens "
            "{pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant les cadeaux **{libelle}** ({ecart_signed_fr}), je propose "
            "de maintenir **{pct_maintenu} %** ({montant_maintenu_fr}). Concession "
            "{montant_concede_fr} sur les dépenses moins documentées."
        ),
        "conciliant": (
            "Pour **{libelle}**, je m'aligne : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Les pièces seront mieux classées l'an prochain."
        ),
    },
    "telephone_internet": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), la quote-part professionnelle "
            "(typiquement 60-70 % en BNC libéral) est appliquée selon usage. **Je "
            "maintiens {pct_maintenu} % soit {montant_maintenu_fr}** ({justif_mention})."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) sur la base d'une quote-part "
            "pro de 60 %. Concession {montant_concede_fr} si tu retiens un ratio plus bas."
        ),
        "conciliant": (
            "Pour **{libelle}**, je te suis : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). La quote-part pourra être revue."
        ),
    },
    "energie_abonnements": {
        "ferme": (
            "Sur **{libelle}** ({ecart_signed_fr}), la quote-part professionnelle "
            "appliquée au prorata du m² pro / m² total est documentée. **Je maintiens "
            "{pct_maintenu} % soit {montant_maintenu_fr}** ({justif_mention})."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) selon le prorata m². "
            "Concession {montant_concede_fr} si nécessaire."
        ),
        "conciliant": (
            "Pour **{libelle}**, je m'aligne : maintien à {pct_maintenu} % "
            "({montant_maintenu_fr}). Le prorata m² sera réajusté."
        ),
    },
    "_fallback": {
        "ferme": (
            "L'écart sur **{libelle}** ({ecart_signed_fr}) est documenté par "
            "{justif_mention} et reste pleinement déductible au titre de l'article 93 CGI "
            "(charge professionnelle nécessaire à l'exercice). **Je maintiens "
            "{pct_maintenu} % soit {montant_maintenu_fr}**."
        ),
        "equilibre": (
            "Concernant **{libelle}** ({ecart_signed_fr}), je propose de maintenir "
            "**{pct_maintenu} %** ({montant_maintenu_fr}) et de concéder "
            "**{montant_concede_fr}** pour clore ce point sans contentieux, dans "
            "l'attente de tes précisions."
        ),
        "conciliant": (
            "Pour **{libelle}**, je me range à ton analyse : concession de "
            "**{montant_concede_fr}** (maintien {pct_maintenu} %). La position pourra "
            "être revue au prochain exercice avec un classement plus défensif."
        ),
    },
}


# ─── Heuristique catégorie → clé template ───


# Tokens → clé template. Match si tous les tokens d'un sous-tuple matchent.
_CATEGORY_KEY_TOKENS: list[tuple[tuple[str, ...], str]] = [
    (("repas pro",), "forfait_repas"),
    (("repas",), "forfait_repas"),
    (("immobilis",), "immobilisations"),
    (("dotation", "amort"), "dotations_amort"),
    (("amortis",), "dotations_amort"),
    (("véhicule",), "quote_part_vehicule"),
    (("vehicule",), "quote_part_vehicule"),
    (("blanchissage",), "blanchissage"),
    (("cadeau",), "cadeaux_reception"),
    (("réception",), "cadeaux_reception"),
    (("reception",), "cadeaux_reception"),
    (("honoraires", "rétroc"), "honoraires_retrocedes"),
    (("honoraires", "retroc"), "honoraires_retrocedes"),
    (("rétrocession",), "honoraires_retrocedes"),
    (("retrocession",), "honoraires_retrocedes"),
    (("remplaçant",), "honoraires_retrocedes"),
    (("remplacant",), "honoraires_retrocedes"),
    (("téléphone",), "telephone_internet"),
    (("telephone",), "telephone_internet"),
    (("internet",), "telephone_internet"),
    (("énergie",), "energie_abonnements"),
    (("energie",), "energie_abonnements"),
    (("électricité",), "energie_abonnements"),
    (("electricite",), "energie_abonnements"),
    (("abonnement",), "energie_abonnements"),
]


def _infer_category_key(item: dict, mapping_flags: Optional[dict] = None) -> str:
    """Devine la clé `_TEMPLATES_BY_CATEGORY` la plus appropriée pour cet item.

    Ordre de priorité :
      1. Flags mapping (apply_quote_part_vehicule, split_csg_deductible, etc.)
      2. Tokens dans `categories_neuronx` ou `compte_label`
      3. Fallback générique
    """
    flags = mapping_flags or {}
    if flags.get("apply_quote_part_vehicule"):
        return "quote_part_vehicule"
    if flags.get("split_csg_deductible"):
        return "csg_crds_split"
    if flags.get("split_urssaf_cotisations"):
        return "urssaf_split"
    if flags.get("is_dotation"):
        return "dotations_amort"

    haystack_parts: list[str] = []
    for c in item.get("categories_neuronx") or []:
        if c:
            haystack_parts.append(str(c).lower())
    for s in item.get("sous_categories_neuronx") or []:
        if s:
            haystack_parts.append(str(s).lower())
    label = (item.get("compte_label") or "").lower()
    rubrique = (item.get("rubrique_2035") or "").lower()
    haystack_parts.extend([label, rubrique])
    haystack = " | ".join(haystack_parts)

    for tokens, key in _CATEGORY_KEY_TOKENS:
        if all(t in haystack for t in tokens):
            return key

    return "_fallback"


def _resolve_template(category_key: str, tone: ConcessionTone) -> str:
    """Retourne le template pour cette (catégorie, ton). Fallback générique."""
    cat = _TEMPLATES_BY_CATEGORY.get(category_key) or _TEMPLATES_BY_CATEGORY["_fallback"]
    return cat.get(tone) or cat["equilibre"]


# ─── BOI/CGI référence extraction ───


def _extract_boi_ref(item: dict, drivers_codes: set[str]) -> Optional[dict]:
    """Récupère un objet `{title, url}` BOI/CGI à citer dans l'argumentation.

    Stratégie :
      1. Si `commentaire` contient une référence détectable via `_BOI_CGI_REGEX`,
         on l'utilise telle quelle (priorité au choix de l'utilisateur).
      2. Sinon, via `_DRIVER_TO_REF` mapping sur les drivers aggravants présents.
      3. Fallback `pieces_justificatives` (rappel exigence pièces).
    """
    from backend.services.plaquette_report_service import (
        _BOI_CGI_REFERENCES,
        _DRIVER_TO_REF,
    )
    from backend.services.plaquette_risque_service import _BOI_CGI_REGEX

    commentaire = (item.get("commentaire") or "").strip()
    if commentaire:
        matches = _BOI_CGI_REGEX.findall(commentaire)
        if matches:
            # Match heuristique : si une clé connue est citée, on la retourne
            commentaire_lower = commentaire.lower()
            for key, ref in _BOI_CGI_REFERENCES.items():
                for kw in ref.get("keywords") or []:
                    if kw.lower() in commentaire_lower:
                        return {"title": ref["title"], "url": ref["url"], "key": key}
            # Sinon on cite tel quel (sans URL)
            return {"title": matches[0].strip(), "url": "", "key": None}

    # Drivers → ref
    for code in drivers_codes:
        key = _DRIVER_TO_REF.get(code)
        if key and key in _BOI_CGI_REFERENCES:
            ref = _BOI_CGI_REFERENCES[key]
            return {"title": ref["title"], "url": ref["url"], "key": key}

    # Fallback générique
    ref = _BOI_CGI_REFERENCES.get("pieces_justificatives")
    if ref:
        return {"title": ref["title"], "url": ref["url"], "key": "pieces_justificatives"}
    return None


# ─── Algo force_score / pct / tone ───


def compute_force_score(item: dict, mapping_flags: Optional[dict] = None) -> float:
    """Calcule la force d'argumentation [0..1] basée sur risque + flags + drivers.

    Plus le score est haut, plus la position est défendable → pct_maintenu élevé.
    """
    score = 0.5  # base neutre
    flags = mapping_flags or {}
    rf = item.get("risque_fiscal") or {}

    # Risque inversé
    niveau = rf.get("niveau")
    if niveau:
        score += _RISQUE_DELTA.get(niveau, 0.0)

    # Drivers atténuants/aggravants explicites
    driver_codes = {d.get("code") for d in (rf.get("drivers") or []) if d.get("code")}
    if "boi_cgi_cite" in driver_codes:
        score += 0.20
    if "statut_resolu" in driver_codes or "statut_refus_justifie" in driver_codes:
        score += 0.10
    if "montant_eleve_sensible" in driver_codes:
        score -= 0.10
    if "taux_justif_bas" in driver_codes:
        score -= 0.05

    # Pièces disponibles renforcent la position
    if rf.get("pieces_disponibles"):
        score += 0.15

    # Forfait/barème = encadrement légal solide
    if (
        flags.get("apply_quote_part_vehicule")
        or flags.get("split_csg_deductible")
        or flags.get("split_urssaf_cotisations")
    ):
        score += 0.10

    return max(0.0, min(1.0, score))


def recommend_pct_maintenu(force_score: float) -> float:
    """Mapping force_score → % maintenu recommandé."""
    for threshold, pct in _THRESHOLDS_PCT:
        if force_score >= threshold:
            return pct
    return 0.0


def infer_tone(force_score: float) -> ConcessionTone:
    """Mapping force_score → ton recommandé."""
    for threshold, tone in _THRESHOLDS_TONE:
        if force_score >= threshold:
            return tone
    return "conciliant"


# ─── Génération argumentation ───


def _resolve_justif_mention(item: dict) -> str:
    """Phrase courte sur la disponibilité des pièces."""
    rf = item.get("risque_fiscal") or {}
    pieces = rf.get("pieces_disponibles") or []
    if not pieces:
        return "pièces disponibles sur demande"
    # Prend la première phrase informative
    return pieces[0]


def _compute_montants(item: dict, pct_maintenu: float) -> tuple[float, float]:
    """Calcule (montant_maintenu, montant_concede) en valeurs absolues.

    Convention :
      - ecart_signed = montant_neuronx − montant_plaquette (peut être négatif)
      - montant_maintenu = montant_plaquette + ecart_signed * pct_maintenu / 100
      - montant_concede  = ecart_signed * (1 − pct_maintenu / 100) en valeur absolue
    """
    mp = float(item.get("montant_plaquette") or 0.0)
    mn = float(item.get("montant_neuronx") or 0.0)
    ecart_signed = mn - mp
    montant_maintenu = mp + ecart_signed * pct_maintenu / 100.0
    montant_concede = ecart_signed * (1.0 - pct_maintenu / 100.0)
    return round(montant_maintenu, 2), round(montant_concede, 2)


def generate_argumentation(
    item: dict,
    pct_maintenu: float,
    tone: ConcessionTone,
    force_score: float,
    mapping_flags: Optional[dict] = None,
) -> tuple[str, list[str]]:
    """Compose le texte d'argumentation en interpolant le bon template.

    Returns:
        (argumentation_text, drivers_used)
    """
    rf = item.get("risque_fiscal") or {}
    driver_codes = {d.get("code") for d in (rf.get("drivers") or []) if d.get("code")}

    category_key = _infer_category_key(item, mapping_flags)
    template = _resolve_template(category_key, tone)
    boi_ref = _extract_boi_ref(item, driver_codes)
    montant_maintenu, montant_concede = _compute_montants(item, pct_maintenu)
    mp = float(item.get("montant_plaquette") or 0.0)
    mn = float(item.get("montant_neuronx") or 0.0)
    ecart_signed = mn - mp

    category_label = ""
    cats = item.get("categories_neuronx") or []
    if cats:
        category_label = cats[0]

    interpolation = {
        "libelle": (item.get("compte_label") or "—").strip(),
        "ecart_signed_fr": _format_eur_fr(ecart_signed, signed=True),
        "montant_maintenu_fr": _format_eur_fr(abs(montant_maintenu)),
        "montant_concede_fr": _format_eur_fr(abs(montant_concede)),
        "pct_maintenu": _round_pct(pct_maintenu),
        "category_label": category_label or "autre",
        "boi_title": (boi_ref or {}).get("title", ""),
        "boi_url": (boi_ref or {}).get("url", ""),
        "justif_mention": _resolve_justif_mention(item),
    }

    try:
        text = template.format(**interpolation)
    except (KeyError, IndexError) as e:
        logger.warning("Template interpolation failed for item %s: %s", item.get("item_id"), e)
        text = (
            f"Sur {interpolation['libelle']} ({interpolation['ecart_signed_fr']}), "
            f"je propose de maintenir {interpolation['pct_maintenu']} % "
            f"soit {interpolation['montant_maintenu_fr']}."
        )

    drivers_used: list[str] = []
    if rf.get("niveau"):
        drivers_used.append(f"risque_{rf.get('niveau')}")
    if boi_ref and boi_ref.get("key"):
        drivers_used.append(f"boi_{boi_ref['key']}")
    if "boi_cgi_cite" in driver_codes:
        drivers_used.append("boi_cite_comment")
    if rf.get("pieces_disponibles"):
        drivers_used.append("pieces")
    if (
        (mapping_flags or {}).get("apply_quote_part_vehicule")
        or (mapping_flags or {}).get("split_csg_deductible")
        or (mapping_flags or {}).get("split_urssaf_cotisations")
    ):
        drivers_used.append("forfait_legal")
    drivers_used.append(f"category_{category_key}")

    return text, drivers_used


# ─── Composition d'une ConcessionEvaluation ───


def compute_concession_for_item(item: dict, mapping_flags: Optional[dict] = None) -> dict:
    """Calcule auto une `ConcessionEvaluation` (sérialisée en dict) pour un item.

    Ne mute PAS l'item. À utiliser depuis `evaluate_all_concessions` qui décide
    si le résultat doit être posé sur l'item ou pas (skip si source=manual).
    """
    force = compute_force_score(item, mapping_flags)
    pct = recommend_pct_maintenu(force)
    tone = infer_tone(force)
    argumentation, drivers_used = generate_argumentation(item, pct, tone, force, mapping_flags)
    montant_maintenu, montant_concede = _compute_montants(item, pct)

    return {
        "pct_maintenu": pct,
        "montant_maintenu": montant_maintenu,
        "montant_concede": montant_concede,
        "source": "auto",
        "tone": tone,
        "force_score": round(force, 3),
        "argumentation": argumentation,
        "auto_argumentation": argumentation,
        "last_updated_at": _now_iso(),
        "drivers_used": drivers_used,
    }


# ─── Évaluation batch ───


def evaluate_all_concessions(plaquette_check: dict, force_recompute: bool = False) -> dict:
    """Pour chaque item `a_challenger`, calcule (ou met à jour) `concession`.

    Règles :
      - Skip si `status == DECLARE` (snapshot figé).
      - Skip si `source == "manual"` et `force_recompute=False`.
      - Skip si `last_updated_at >= last_modified_at` (cache) sauf force_recompute.
      - Cleanup : `concession = None` si statut passe à `ok` / `resolu` / `refus_justifie`.

    Le dict est muté + retourné pour chaînage.
    """
    if plaquette_check.get("status") == PlaquetteCheckStatus.DECLARE.value:
        logger.debug("evaluate_all_concessions: skip — plaquette declared (figée)")
        return plaquette_check

    from backend.services import plaquette_pcg_mapping_service

    template = plaquette_check.get("cabinet_template") or "sygnatures_marenco"
    items = plaquette_check.get("items", []) or []

    for item in items:
        statut = (item.get("statut") or "").strip()

        # Cleanup : si l'item n'est plus à challenger, retire la concession
        if statut != "a_challenger":
            if item.get("concession") is not None:
                item["concession"] = None
            continue

        existing = item.get("concession")
        if existing and not force_recompute:
            # Préserver override manuel
            if existing.get("source") == "manual":
                continue
            # Cache : skip si pas modifié récemment
            last_eval = existing.get("last_updated_at") or ""
            last_mod = item.get("last_modified_at") or ""
            if last_eval and last_eval >= last_mod:
                continue

        try:
            _, _, flags = plaquette_pcg_mapping_service.resolve(item.get("compte_pcg"), template)
        except Exception as e:
            logger.debug("mapping resolve failed for %s: %s", item.get("compte_pcg"), e)
            flags = {}

        item["concession"] = compute_concession_for_item(item, flags)

    return plaquette_check


# ─── Override manuel / Reset / Régénération ───


def _find_item_or_raise(plaquette_check: dict, item_id: str) -> dict:
    items = plaquette_check.get("items", []) or []
    for it in items:
        if it.get("item_id") == item_id:
            return it
    raise ValueError(f"Item {item_id} introuvable")


def override_item_concession(
    plaquette_check: dict,
    item_id: str,
    pct_maintenu: Optional[float] = None,
    tone: Optional[ConcessionTone] = None,
    argumentation: Optional[str] = None,
) -> dict:
    """Override manuel d'un ou plusieurs champs de la concession.

    Règles :
      - Crée la concession via `compute_concession_for_item` si absente.
      - Fige `source = "manual"`.
      - Si `argumentation` n'est PAS fourni mais pct/tone change → régénère
        automatiquement le texte avec les nouvelles valeurs.
      - Si `argumentation` est fourni explicitement → garde tel quel (override texte).
      - Recalcule `montant_maintenu` / `montant_concede` si pct change.
    """
    from backend.services import plaquette_pcg_mapping_service

    item = _find_item_or_raise(plaquette_check, item_id)
    template = plaquette_check.get("cabinet_template") or "sygnatures_marenco"

    try:
        _, _, flags = plaquette_pcg_mapping_service.resolve(item.get("compte_pcg"), template)
    except Exception:
        flags = {}

    concession = item.get("concession") or compute_concession_for_item(item, flags)

    new_pct = float(pct_maintenu) if pct_maintenu is not None else float(concession.get("pct_maintenu", 0.0))
    new_tone: ConcessionTone = tone or concession.get("tone", "equilibre")

    pct_or_tone_changed = (
        pct_maintenu is not None
        and float(pct_maintenu) != float(concession.get("pct_maintenu", -1))
    ) or (tone is not None and tone != concession.get("tone"))

    if argumentation is not None:
        new_text = argumentation
    elif pct_or_tone_changed:
        new_text, _drivers = generate_argumentation(
            item,
            new_pct,
            new_tone,
            float(concession.get("force_score", 0.5)),
            flags,
        )
    else:
        new_text = concession.get("argumentation", "")

    montant_maintenu, montant_concede = _compute_montants(item, new_pct)

    concession.update({
        "pct_maintenu": new_pct,
        "montant_maintenu": montant_maintenu,
        "montant_concede": montant_concede,
        "tone": new_tone,
        "argumentation": new_text,
        "source": "manual",
        "last_updated_at": _now_iso(),
    })
    item["concession"] = concession
    return item


def reset_item_concession_auto(plaquette_check: dict, item_id: str) -> dict:
    """Repasse en mode auto + recalcule via `compute_concession_for_item`."""
    from backend.services import plaquette_pcg_mapping_service

    item = _find_item_or_raise(plaquette_check, item_id)
    template = plaquette_check.get("cabinet_template") or "sygnatures_marenco"

    try:
        _, _, flags = plaquette_pcg_mapping_service.resolve(item.get("compte_pcg"), template)
    except Exception:
        flags = {}

    item["concession"] = compute_concession_for_item(item, flags)
    return item


def regenerate_argumentation_for_item(plaquette_check: dict, item_id: str) -> dict:
    """Régénère uniquement le texte d'argumentation (garde pct/tone/source actuels)."""
    from backend.services import plaquette_pcg_mapping_service

    item = _find_item_or_raise(plaquette_check, item_id)
    concession = item.get("concession")
    if not concession:
        # Pas de concession → on en crée une auto
        return reset_item_concession_auto(plaquette_check, item_id)

    template = plaquette_check.get("cabinet_template") or "sygnatures_marenco"
    try:
        _, _, flags = plaquette_pcg_mapping_service.resolve(item.get("compte_pcg"), template)
    except Exception:
        flags = {}

    new_text, _drivers = generate_argumentation(
        item,
        float(concession.get("pct_maintenu", 0.0)),
        concession.get("tone", "equilibre"),
        float(concession.get("force_score", 0.5)),
        flags,
    )
    concession["argumentation"] = new_text
    concession["last_updated_at"] = _now_iso()
    item["concession"] = concession
    return item


# ─── Synthèse globale ───


def compute_synthesis(plaquette_check: dict) -> dict:
    """Compose un dict `NegociationSynthesis` (BNC initial/simulé + IR projeté + compteurs).

    Convention signe : pour les comptes de charges (is_recettes=False), une concession
    correspond à un montant que l'utilisateur accepte de NE PAS déduire → le BNC monte
    d'autant. `bnc_simule = bnc_neuronx_initial + sum(concession_charges)`.
    Pour les items de recettes (is_recettes=True), une concession à la hausse augmente
    le BNC dans le même sens : on additionne aussi.
    """
    from backend.services import bnc_service, fiscal_service, plaquette_pcg_mapping_service

    year = plaquette_check.get("year")
    template = plaquette_check.get("cabinet_template") or "sygnatures_marenco"

    # Items à challenger avec concession
    items_with_concession: list[dict] = []
    for it in plaquette_check.get("items", []) or []:
        if it.get("statut") != "a_challenger":
            continue
        if it.get("concession"):
            items_with_concession.append(it)

    # Compteurs par bucket
    nb_total = len(items_with_concession)
    nb_maintenus = 0
    nb_en_discussion = 0
    nb_concedes = 0
    concession_totale = 0.0

    for it in items_with_concession:
        c = it.get("concession") or {}
        pct = float(c.get("pct_maintenu", 0.0))
        montant_concede_signed = float(c.get("montant_concede", 0.0))
        concession_totale += abs(montant_concede_signed)
        if pct >= 100.0:
            nb_maintenus += 1
        elif pct <= 0.0:
            nb_concedes += 1
        else:
            nb_en_discussion += 1

    # BNC initial + simulé
    bnc_initial = 0.0
    bnc_simule = 0.0
    try:
        breakdown = bnc_service.compute_bnc(year)
        bnc_initial = float(breakdown.bnc)
        # Concession sur charge → BNC monte
        total_charge_concedee = 0.0
        for it in items_with_concession:
            try:
                _, _, flags = plaquette_pcg_mapping_service.resolve(it.get("compte_pcg"), template)
            except Exception:
                flags = {}
            c = it.get("concession") or {}
            montant_concede_signed = float(c.get("montant_concede", 0.0))
            # is_recettes : la concession diminue les recettes déclarées → BNC baisse
            # is_charge   : la concession diminue les charges déduites → BNC monte
            if flags.get("is_recettes"):
                total_charge_concedee -= montant_concede_signed
            else:
                total_charge_concedee += montant_concede_signed
        bnc_simule = bnc_initial + total_charge_concedee
    except Exception as e:
        logger.warning("compute_bnc(%s) failed: %s", year, e)

    # IR projeté actuel vs simulé
    ir_actuel: Optional[float] = None
    ir_simule: Optional[float] = None
    economie_ir: Optional[float] = None
    try:
        if bnc_initial > 0:
            sim_act = fiscal_service.simulate_multi(bnc_initial, year, parts=1.0, leviers={})
            ir_actuel = float(sim_act.get("ir_actuel", 0.0))
            if bnc_simule > 0:
                sim_sim = fiscal_service.simulate_multi(bnc_simule, year, parts=1.0, leviers={})
                ir_simule = float(sim_sim.get("ir_actuel", 0.0))
                economie_ir = round(ir_actuel - ir_simule, 2)
    except Exception as e:
        logger.warning("IR projection failed: %s", e)

    return {
        "year": year,
        "nb_items_total": nb_total,
        "nb_items_maintenus": nb_maintenus,
        "nb_items_en_discussion": nb_en_discussion,
        "nb_items_concedes": nb_concedes,
        "concession_totale": round(concession_totale, 2),
        "bnc_neuronx_initial": round(bnc_initial, 2),
        "bnc_simule": round(bnc_simule, 2),
        "ir_projete_actuel": ir_actuel,
        "ir_projete_simule": ir_simule,
        "economie_ir": economie_ir,
    }
