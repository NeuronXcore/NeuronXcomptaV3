"""Schemas Pydantic pour les settings."""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


class ThemeSettings(BaseModel):
    primary_color: str = "#811971"
    background_color: str = "#cccce2"
    text_color: str = "#f1efe8"


class JustificatifExemptions(BaseModel):
    categories: list[str] = ["Perso"]
    sous_categories: dict[str, list[str]] = {}


class AppSettings(BaseModel):
    theme_settings: ThemeSettings = ThemeSettings()
    dark_mode: bool = True
    notifications: bool = True
    num_operations: int = 50
    export_format: str = "PDF"
    include_graphs: bool = True
    compress_exports: bool = False
    auto_pointage: bool = True
    justificatif_exemptions: JustificatifExemptions = Field(default_factory=JustificatifExemptions)
    # Email comptable
    email_smtp_user: Optional[str] = None
    email_smtp_app_password: Optional[str] = None
    email_comptable_destinataires: list[str] = []
    email_default_nom: Optional[str] = None
    # ML retrain — seuils de déclenchement de la tâche auto "Réentraîner le modèle IA".
    # Condition combinée : corrections_count >= corrections_threshold
    #                OR (corrections_count >= 1 AND days_since_training >= days_threshold)
    ml_retrain_corrections_threshold: int = 10
    ml_retrain_days_threshold: int = 14
    # Sandbox — mode de traitement des fichiers non-canoniques déposés.
    # Off par défaut (mode manuel) : user doit cliquer « Lancer OCR » dans l'onglet Sandbox.
    # On : auto-processor loop traite les fichiers arrivés depuis > delay.
    sandbox_auto_mode: bool = False
    sandbox_auto_delay_seconds: int = 30
    # Check d'envoi — offsets en jours après fin de période avant déclenchement reminder.
    # N1 = niveau 1 (informatif), N2 = niveau 2 (insistant), N3 = niveau 3 (retard).
    check_envoi_reminder_n1_offset: int = 10
    check_envoi_reminder_n2_offset: int = 15
    check_envoi_reminder_n3_offset: int = 20
    # ISO date YYYY-MM-DD : pendant cette fenêtre, _compute_level retourne None (pas de reminder).
    check_envoi_vacances_jusquau: Optional[str] = None
    # Rappels Dashboard — bandeau replié par défaut (UX : ne pas surcharger).
    rappels_collapsed: bool = True
    # Liste des `rule_id` désactivés par l'utilisateur (toggle UI dans le bandeau).
    # Les règles désactivées sont skip à l'évaluation par l'engine.
    rappels_disabled_rules: list[str] = []


class DiskSpaceInfo(BaseModel):
    total_gb: float
    used_gb: float
    free_gb: float
    percent_used: float


class BackupInfo(BaseModel):
    name: str
    date: str
    size_mb: float
