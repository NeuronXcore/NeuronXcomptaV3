from __future__ import annotations

"""Service de monitoring pour l'agent IA — logging prédictions, corrections, stats."""

import json
import logging
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    ML_PREDICTIONS_LOG_DIR,
    ML_CORRECTIONS_LOG_DIR,
    ML_LOGS_DIR,
    IMPORTS_OPERATIONS_DIR,
    ensure_directories,
)
from backend.models.ml import (
    PredictionBatchLog,
    CorrectionLog,
    TrainingLog,
    MLMonitoringStats,
    MLHealthKPI,
)

logger = logging.getLogger(__name__)

TRAININGS_FILE = ML_LOGS_DIR / "trainings.json"


# ── Logging ──────────────────────────────────────────────────────────────


def log_prediction_batch(batch: PredictionBatchLog) -> None:
    """Sauvegarde un batch de prédictions."""
    ensure_directories()
    safe_name = batch.filename.replace("/", "_").replace(".json", "")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = ML_PREDICTIONS_LOG_DIR / f"pred_{ts}_{safe_name}.json"
    path.write_text(json.dumps(batch.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")


def log_corrections(filename: str, corrections: list[CorrectionLog]) -> None:
    """Enregistre les corrections dans le fichier mensuel."""
    if not corrections:
        return
    ensure_directories()
    month_key = datetime.now().strftime("%Y_%m")
    path = ML_CORRECTIONS_LOG_DIR / f"corrections_{month_key}.json"
    existing: list[dict] = []
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            existing = []
    existing.extend([c.model_dump() for c in corrections])
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def log_training(log: TrainingLog) -> None:
    """Append un log d'entraînement."""
    ensure_directories()
    existing: list[dict] = []
    if TRAININGS_FILE.exists():
        try:
            existing = json.loads(TRAININGS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            existing = []
    existing.append(log.model_dump())
    TRAININGS_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Correction detection ────────────────────────────────────────────────


def _find_latest_prediction_log(filename: str) -> Optional[PredictionBatchLog]:
    """Trouve le log de prédiction le plus récent pour un fichier."""
    if not ML_PREDICTIONS_LOG_DIR.exists():
        return None
    safe_name = filename.replace("/", "_").replace(".json", "")
    matching = sorted(
        [f for f in ML_PREDICTIONS_LOG_DIR.iterdir() if safe_name in f.name and f.suffix == ".json"],
        reverse=True,
    )
    if not matching:
        return None
    try:
        data = json.loads(matching[0].read_text(encoding="utf-8"))
        return PredictionBatchLog(**data)
    except Exception:
        return None


def detect_corrections(filename: str, operations: list[dict]) -> list[CorrectionLog]:
    """Compare les opérations sauvegardées avec le dernier batch de prédictions."""
    batch = _find_latest_prediction_log(filename)
    if not batch:
        return []

    pred_map: dict[str, dict] = {}
    for p in batch.predictions:
        pred_map[p.libelle] = p.model_dump()

    now = datetime.now().isoformat()
    corrections: list[CorrectionLog] = []

    for idx, op in enumerate(operations):
        libelle = op.get("Libellé", "")
        cat = op.get("Catégorie", "")
        sub = op.get("Sous-catégorie", "")

        pred = pred_map.get(libelle)
        if not pred:
            continue

        if cat and cat != pred["predicted_category"]:
            corrections.append(CorrectionLog(
                timestamp=now,
                filename=filename,
                operation_index=idx,
                libelle=libelle,
                predicted_category=pred["predicted_category"],
                predicted_subcategory=pred.get("predicted_subcategory"),
                corrected_category=cat,
                corrected_subcategory=sub or None,
                prediction_source=pred.get("source"),
            ))

    return corrections


# ── Stats loading helpers ────────────────────────────────────────────────


def _load_all_prediction_logs(year: Optional[int] = None) -> list[PredictionBatchLog]:
    """Charge tous les logs de prédiction, optionnellement filtrés par année."""
    if not ML_PREDICTIONS_LOG_DIR.exists():
        return []
    logs: list[PredictionBatchLog] = []
    for f in sorted(ML_PREDICTIONS_LOG_DIR.iterdir()):
        if f.suffix != ".json":
            continue
        if year is not None:
            # Filter by year in filename (pred_YYYYMMDD_...)
            try:
                file_year = int(f.name[5:9])
                if file_year != year:
                    continue
            except (ValueError, IndexError):
                pass
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            logs.append(PredictionBatchLog(**data))
        except Exception:
            continue
    return logs


def _load_all_corrections(year: Optional[int] = None) -> list[CorrectionLog]:
    """Charge toutes les corrections, optionnellement filtrées par année."""
    if not ML_CORRECTIONS_LOG_DIR.exists():
        return []
    corrections: list[CorrectionLog] = []
    for f in sorted(ML_CORRECTIONS_LOG_DIR.iterdir()):
        if f.suffix != ".json":
            continue
        if year is not None:
            try:
                file_year = int(f.name.split("_")[1])
                if file_year != year:
                    continue
            except (ValueError, IndexError):
                pass
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            for item in data:
                corrections.append(CorrectionLog(**item))
        except Exception:
            continue
    return corrections


def _load_training_logs() -> list[TrainingLog]:
    """Charge tous les logs d'entraînement."""
    if not TRAININGS_FILE.exists():
        return []
    try:
        data = json.loads(TRAININGS_FILE.read_text(encoding="utf-8"))
        return [TrainingLog(**item) for item in data]
    except Exception:
        return []


def _compute_coverage_rate(year: Optional[int] = None) -> float:
    """Calcule le taux de couverture depuis les fichiers d'opérations."""
    if not IMPORTS_OPERATIONS_DIR.exists():
        return 0.0
    total = 0
    categorized = 0
    for f in IMPORTS_OPERATIONS_DIR.iterdir():
        if f.suffix != ".json":
            continue
        try:
            ops = json.loads(f.read_text(encoding="utf-8"))
            if not ops:
                continue
            # Year filter
            if year is not None:
                from backend.services.operation_service import list_operation_files
                # Simple check: parse dates to get year
                dates = [op.get("Date", "") for op in ops if op.get("Date")]
                if dates:
                    from collections import Counter as C
                    years = []
                    for d in dates:
                        try:
                            if "-" in d:
                                years.append(int(d[:4]))
                            elif "/" in d:
                                parts = d.split("/")
                                y = int(parts[-1])
                                if y < 100:
                                    y += 2000
                                years.append(y)
                        except (ValueError, IndexError):
                            pass
                    if years:
                        most_common_year = C(years).most_common(1)[0][0]
                        if most_common_year != year:
                            continue
            for op in ops:
                total += 1
                cat = op.get("Catégorie", "")
                if cat and cat != "Autres":
                    categorized += 1
        except Exception:
            continue
    return categorized / total if total > 0 else 0.0


# ── Main stats functions ─────────────────────────────────────────────────


def get_monitoring_stats(year: Optional[int] = None) -> MLMonitoringStats:
    """Calcule tous les indicateurs agrégés."""
    pred_logs = _load_all_prediction_logs(year)
    corrections = _load_all_corrections(year)
    training_logs = _load_training_logs()

    # Coverage
    coverage_rate = _compute_coverage_rate(year)

    # Confidence stats from predictions
    all_preds = []
    for batch in pred_logs:
        all_preds.extend(batch.predictions)

    total_preds = len(all_preds)
    avg_confidence = 0.0
    high = medium = low = 0
    hallucination_count = 0
    unknown_count = 0

    if total_preds > 0:
        confs = [p.confidence for p in all_preds]
        avg_confidence = sum(confs) / len(confs)
        high = sum(1 for c in confs if c >= 0.8)
        medium = sum(1 for c in confs if 0.5 <= c < 0.8)
        low = sum(1 for c in confs if c < 0.5)
        hallucination_count = sum(1 for p in all_preds if p.hallucination_risk)
        unknown_count = sum(
            1 for p in all_preds if p.source == "sklearn" and p.confidence < 0.3
        )

    # Correction rate
    correction_rate = len(corrections) / total_preds if total_preds > 0 else 0.0
    hallucination_rate = hallucination_count / total_preds if total_preds > 0 else 0.0

    # Top errors
    error_counter: Counter = Counter()
    for c in corrections:
        error_counter[(c.libelle[:40], c.predicted_category, c.corrected_category)] += 1
    top_errors = [
        {"libelle": k[0], "predicted": k[1], "corrected": k[2], "count": v}
        for k, v in error_counter.most_common(10)
    ]

    # Correction rate history (by month)
    monthly_corrections: dict[str, int] = {}
    for c in corrections:
        month = c.timestamp[:7]  # YYYY-MM
        monthly_corrections[month] = monthly_corrections.get(month, 0) + 1

    monthly_preds: dict[str, int] = {}
    for batch in pred_logs:
        month = batch.timestamp[:7]
        monthly_preds[month] = monthly_preds.get(month, 0) + batch.predicted

    all_months = sorted(set(list(monthly_corrections.keys()) + list(monthly_preds.keys())))
    correction_rate_history = []
    for m in all_months:
        preds = monthly_preds.get(m, 0)
        corrs = monthly_corrections.get(m, 0)
        rate = corrs / preds if preds > 0 else 0.0
        correction_rate_history.append({"month": m, "rate": round(rate, 4)})

    # Knowledge base
    knowledge_base = {"rules": 0, "keywords": 0, "examples": 0}
    try:
        from backend.services.ml_service import load_rules_model, get_training_examples
        model = load_rules_model()
        knowledge_base["rules"] = len(model.get("exact_matches", {}))
        knowledge_base["keywords"] = len(model.get("keywords", {}))
        knowledge_base["examples"] = len(get_training_examples())
    except Exception:
        pass

    # Confusion pairs
    confusion_counter: Counter = Counter()
    for c in corrections:
        confusion_counter[(c.predicted_category, c.corrected_category)] += 1
    confusion_pairs = [
        {"from": k[0], "to": k[1], "count": v}
        for k, v in confusion_counter.most_common(10)
    ]

    # Orphan categories (< 5 examples)
    orphan_categories: list[dict] = []
    try:
        from backend.services.ml_service import get_training_examples
        examples = get_training_examples()
        cat_counts: Counter = Counter()
        for ex in examples:
            cat_counts[ex.get("categorie", "")] += 1
        orphan_categories = [
            {"category": cat, "examples_count": count}
            for cat, count in cat_counts.items()
            if count < 5 and cat
        ]
    except Exception:
        pass

    return MLMonitoringStats(
        coverage_rate=round(coverage_rate, 4),
        avg_confidence=round(avg_confidence, 4),
        confidence_distribution={"high": high, "medium": medium, "low": low},
        correction_rate=round(correction_rate, 4),
        hallucination_rate=round(hallucination_rate, 4),
        top_errors=top_errors,
        training_history=training_logs,
        correction_rate_history=correction_rate_history,
        knowledge_base=knowledge_base,
        confusion_pairs=confusion_pairs,
        orphan_categories=orphan_categories,
        unknown_libelles_count=unknown_count,
    )


def get_health_kpi() -> MLHealthKPI:
    """KPI résumé pour le Dashboard."""
    stats = get_monitoring_stats()

    # Correction trend
    history = stats.correction_rate_history
    trend = "stable"
    if len(history) >= 2:
        diff = history[-1]["rate"] - history[-2]["rate"]
        if diff < -0.05:
            trend = "improving"
        elif diff > 0.05:
            trend = "degrading"

    # Last training
    last_training = None
    if stats.training_history:
        last_training = stats.training_history[-1].timestamp

    # Alert
    alert = None
    if stats.correction_rate > 0.25:
        alert = "Taux d'erreur élevé (>25%)"
    elif stats.hallucination_rate > 0.10:
        alert = "Hallucinations fréquentes (>10%)"
    elif stats.coverage_rate < 0.70:
        alert = "Couverture faible (<70%)"

    return MLHealthKPI(
        coverage_rate=stats.coverage_rate,
        correction_rate=stats.correction_rate,
        correction_trend=trend,
        hallucination_rate=stats.hallucination_rate,
        last_training=last_training,
        alert=alert,
    )


def get_confusion_matrix(year: Optional[int] = None) -> list[dict]:
    """Matrice de confusion depuis les corrections loggées."""
    corrections = _load_all_corrections(year)
    counter: Counter = Counter()
    for c in corrections:
        counter[(c.predicted_category, c.corrected_category)] += 1
    return [
        {"from": k[0], "to": k[1], "count": v}
        for k, v in counter.most_common(10)
    ]


def get_correction_rate_history() -> list[dict]:
    """Taux de correction par mois."""
    stats = get_monitoring_stats()
    return stats.correction_rate_history
