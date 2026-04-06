from __future__ import annotations

from pydantic import BaseModel
from typing import Optional
from enum import Enum


class PredictionSource(str, Enum):
    exact_match = "exact_match"
    keywords = "keywords"
    sklearn = "sklearn"
    simple = "simple"


class PredictionLog(BaseModel):
    libelle: str
    predicted_category: str
    predicted_subcategory: Optional[str] = None
    confidence: float
    source: PredictionSource
    hallucination_risk: bool


class PredictionBatchLog(BaseModel):
    timestamp: str
    filename: str
    mode: str
    total_operations: int
    predicted: int
    high_confidence: int
    medium_confidence: int
    low_confidence: int
    hallucination_flags: int
    predictions: list[PredictionLog]


class CorrectionLog(BaseModel):
    timestamp: str
    filename: str
    operation_index: int
    libelle: str
    predicted_category: str
    predicted_subcategory: Optional[str] = None
    corrected_category: str
    corrected_subcategory: Optional[str] = None
    prediction_source: Optional[PredictionSource] = None


class TrainingLog(BaseModel):
    timestamp: str
    examples_count: int
    accuracy: Optional[float] = None
    rules_count: int
    keywords_count: int


class MLMonitoringStats(BaseModel):
    coverage_rate: float
    avg_confidence: float
    confidence_distribution: dict
    correction_rate: float
    hallucination_rate: float
    top_errors: list[dict]
    training_history: list[TrainingLog]
    correction_rate_history: list[dict]
    knowledge_base: dict
    confusion_pairs: list[dict]
    orphan_categories: list[dict]
    unknown_libelles_count: int


class MLHealthKPI(BaseModel):
    coverage_rate: float
    correction_rate: float
    correction_trend: str
    hallucination_rate: float
    last_training: Optional[str] = None
    alert: Optional[str] = None
