from __future__ import annotations

import hashlib
import logging
import math
import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Tuple

import numpy as np

from backend.core.config import DATA_DIR, ensure_directories
from backend.models.echeancier import (
    Recurrence,
    Echeance,
    EcheancierStats,
    SoldePrevisionnel,
)
from backend.services.operation_service import list_operation_files, load_operations

logger = logging.getLogger(__name__)

# Tolérance en jours pour classifier la périodicité
PERIODICITE_MAP: List[Tuple[str, int, int]] = [
    ("hebdomadaire", 7, 3),
    ("bi_mensuel", 15, 3),
    ("mensuel", 30, 3),
    ("trimestriel", 91, 3),
    ("semestriel", 182, 3),
    ("annuel", 365, 3),
]

# Cache mémoire des échéances générées (reset à chaque redémarrage)
_echeances_cache: Dict[str, Echeance] = {}


def normalize_libelle(libelle: str) -> str:
    """Supprime les éléments variables (chiffres, références, dates) pour grouper."""
    if not libelle:
        return ""
    text = libelle.upper().strip()
    # Supprimer les dates (DD/MM/YYYY, DD-MM-YYYY, DDMMYYYY, etc.)
    text = re.sub(r"\d{2}[/\-\.]\d{2}[/\-\.]\d{2,4}", "", text)
    # Supprimer les séquences de 4+ chiffres (références, numéros de compte)
    text = re.sub(r"\d{4,}", "", text)
    # Supprimer les montants (123,45 ou 123.45)
    text = re.sub(r"\d+[,\.]\d{2}", "", text)
    # Supprimer les chiffres isolés restants (2-3 digits)
    text = re.sub(r"\b\d{1,3}\b", "", text)
    # Supprimer les espaces multiples
    text = re.sub(r"\s+", " ", text).strip()
    # Supprimer les caractères spéciaux en fin de chaîne
    text = re.sub(r"[/\-\.\s]+$", "", text)
    return text


def _classify_periodicite(avg_interval: float) -> Optional[str]:
    """Classifie un intervalle moyen en périodicité."""
    for name, target, tolerance in PERIODICITE_MAP:
        if abs(avg_interval - target) <= tolerance:
            return name
    return None


def _get_all_operations() -> List[dict]:
    """Charge toutes les opérations depuis tous les fichiers."""
    ensure_directories()
    all_ops = []
    files = list_operation_files()
    for file_info in files:
        filename = file_info.get("filename", "")
        if not filename:
            continue
        try:
            ops = load_operations(filename)
            for i, op in enumerate(ops):
                op["_source_file"] = filename
                op["_source_index"] = i
            all_ops.extend(ops)
        except Exception as e:
            logger.warning(f"Erreur chargement {filename}: {e}")
    return all_ops


def detect_recurrences() -> List[Recurrence]:
    """Détecte les paiements récurrents depuis l'ensemble des opérations."""
    ensure_directories()
    all_ops = _get_all_operations()
    if not all_ops:
        return []

    # Grouper par libellé normalisé
    groups: Dict[str, List[dict]] = defaultdict(list)
    for op in all_ops:
        libelle = op.get("Libellé", op.get("Libelle", ""))
        if not libelle:
            continue
        normalized = normalize_libelle(libelle)
        if len(normalized) < 3:
            continue
        groups[normalized].append(op)

    recurrences = []
    for normalized, ops in groups.items():
        if len(ops) < 2:
            continue

        # Extraire les dates et trier
        dated_ops = []
        for op in ops:
            date_str = op.get("Date", "")
            if not date_str:
                continue
            try:
                dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
                dated_ops.append((dt, op))
            except (ValueError, TypeError):
                # Essayer format DD/MM/YYYY
                try:
                    dt = datetime.strptime(str(date_str)[:10], "%d/%m/%Y")
                    dated_ops.append((dt, op))
                except (ValueError, TypeError):
                    continue

        if len(dated_ops) < 2:
            continue

        dated_ops.sort(key=lambda x: x[0])

        # Calculer les intervalles
        dates = [d[0] for d in dated_ops]
        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        intervals = [i for i in intervals if i > 0]  # Exclure intervalles nuls

        if not intervals:
            continue

        avg_interval = float(np.mean(intervals))
        std_interval = float(np.std(intervals))

        # Classifier la périodicité
        periodicite = _classify_periodicite(avg_interval)
        if periodicite is None:
            continue

        # Filtrer : std trop élevée → pas récurrent
        if std_interval > 10:
            continue

        # Calculer les montants
        montants = []
        for _, op in dated_ops:
            debit = op.get("Débit", op.get("Debit", 0))
            credit = op.get("Crédit", op.get("Credit", 0))
            if isinstance(debit, (int, float)) and not math.isnan(debit) and debit > 0:
                montants.append(-debit)
            elif isinstance(credit, (int, float)) and not math.isnan(credit) and credit > 0:
                montants.append(credit)
            else:
                montants.append(0)

        montant_moyen = float(np.mean(montants)) if montants else 0
        montant_std = float(np.std(montants)) if montants else 0

        # Score de fiabilité
        fiabilite = max(0.0, min(1.0, 1.0 - (std_interval / avg_interval))) if avg_interval > 0 else 0

        # Dernière occurrence
        last_op = dated_ops[-1]
        derniere_date = last_op[0].strftime("%Y-%m-%d")

        # Catégorie (de la dernière occurrence)
        categorie = last_op[1].get("Catégorie", last_op[1].get("Categorie", None))

        # Libellé display (dernier libellé original)
        libelle_display = last_op[1].get("Libellé", last_op[1].get("Libelle", normalized))

        rec_id = hashlib.md5(normalized.encode()).hexdigest()[:12]

        recurrences.append(Recurrence(
            id=rec_id,
            libelle_display=libelle_display,
            libelle_normalized=normalized,
            periodicite=periodicite,
            montant_moyen=round(montant_moyen, 2),
            montant_std=round(montant_std, 2),
            derniere_occurrence=derniere_date,
            nb_occurrences=len(dated_ops),
            fiabilite=round(fiabilite, 2),
            categorie=categorie,
        ))

    # Trier par fiabilité décroissante
    recurrences.sort(key=lambda r: r.fiabilite, reverse=True)
    return recurrences


def generate_echeancier(recurrences: List[Recurrence], horizon_mois: int = 6) -> List[Echeance]:
    """Projette les échéances futures à partir des récurrences détectées."""
    global _echeances_cache

    now = datetime.now()
    horizon_date = now + timedelta(days=horizon_mois * 30)
    echeances = []

    interval_days = {
        "hebdomadaire": 7,
        "bi_mensuel": 15,
        "mensuel": 30,
        "trimestriel": 91,
        "semestriel": 182,
        "annuel": 365,
    }

    for rec in recurrences:
        delta = timedelta(days=interval_days.get(rec.periodicite, 30))
        try:
            last_date = datetime.strptime(rec.derniere_occurrence, "%Y-%m-%d")
        except ValueError:
            continue

        # Projeter les prochaines dates
        next_date = last_date + delta
        while next_date <= horizon_date:
            if next_date >= now - timedelta(days=3):  # Inclure les échéances très récentes
                ech_id = str(uuid.uuid4())[:8]
                ech = Echeance(
                    id=ech_id,
                    recurrence_id=rec.id,
                    date_prevue=next_date.strftime("%Y-%m-%d"),
                    date_min=(next_date - timedelta(days=3)).strftime("%Y-%m-%d"),
                    date_max=(next_date + timedelta(days=3)).strftime("%Y-%m-%d"),
                    libelle=rec.libelle_display,
                    montant_prevu=rec.montant_moyen,
                    incertitude=rec.montant_std,
                    periodicite=rec.periodicite,
                    fiabilite=rec.fiabilite,
                    statut="prevu",
                )
                echeances.append(ech)
                _echeances_cache[ech_id] = ech
            next_date += delta

    # Trier par date
    echeances.sort(key=lambda e: e.date_prevue)
    return echeances


def compute_solde_previsionnel(
    solde_actuel: float,
    echeances: List[Echeance],
) -> List[SoldePrevisionnel]:
    """Calcule la timeline du solde prévisionnel."""
    timeline = []
    solde = solde_actuel

    # Point de départ
    now = datetime.now()
    timeline.append(SoldePrevisionnel(
        date=now.strftime("%Y-%m-%d"),
        solde=round(solde, 2),
        evenement="Solde actuel",
        montant=0,
        alerte=solde < 0,
    ))

    # Ajouter chaque échéance prévue
    for ech in echeances:
        if ech.statut == "annule":
            continue
        solde += ech.montant_prevu
        timeline.append(SoldePrevisionnel(
            date=ech.date_prevue,
            solde=round(solde, 2),
            evenement=ech.libelle,
            montant=round(ech.montant_prevu, 2),
            alerte=solde < 0,
        ))

    return timeline


def confirm_echeance(echeance_id: str, operation_file: str, operation_index: int) -> Optional[Echeance]:
    """Marque une échéance comme réalisée."""
    ech = _echeances_cache.get(echeance_id)
    if not ech:
        return None
    updated = ech.model_copy(update={
        "statut": "realise",
        "operation_liee": f"{operation_file}::{operation_index}",
    })
    _echeances_cache[echeance_id] = updated
    return updated


def annuler_echeance(echeance_id: str) -> Optional[Echeance]:
    """Annule une échéance prévue."""
    ech = _echeances_cache.get(echeance_id)
    if not ech:
        return None
    updated = ech.model_copy(update={"statut": "annule"})
    _echeances_cache[echeance_id] = updated
    return updated


def get_echeancier_stats(echeances: List[Echeance]) -> EcheancierStats:
    """Calcule les statistiques de l'échéancier."""
    par_periodicite: Dict[str, int] = defaultdict(int)
    total_mensuel = 0.0

    for ech in echeances:
        if ech.statut == "annule":
            continue
        par_periodicite[ech.periodicite] += 1

    # Calculer le montant mensuel moyen
    for ech in echeances:
        if ech.statut == "annule":
            continue
        montant = abs(ech.montant_prevu)
        if ech.periodicite == "hebdomadaire":
            total_mensuel += montant * 4.33
        elif ech.periodicite == "bi_mensuel":
            total_mensuel += montant * 2
        elif ech.periodicite == "mensuel":
            total_mensuel += montant
        elif ech.periodicite == "trimestriel":
            total_mensuel += montant / 3
        elif ech.periodicite == "semestriel":
            total_mensuel += montant / 6
        elif ech.periodicite == "annuel":
            total_mensuel += montant / 12

    # Compter les alertes découvert
    solde_timeline = compute_solde_previsionnel(0, echeances)
    nb_alertes = sum(1 for s in solde_timeline if s.alerte)

    return EcheancierStats(
        total=len([e for e in echeances if e.statut != "annule"]),
        par_periodicite=dict(par_periodicite),
        montant_mensuel_moyen=round(total_mensuel, 2),
        nb_alertes_decouvert=nb_alertes,
    )
