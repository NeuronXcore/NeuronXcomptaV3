"""Schemas Pydantic pour les settings."""

from pydantic import BaseModel
from typing import Optional


class ThemeSettings(BaseModel):
    primary_color: str = "#811971"
    background_color: str = "#cccce2"
    text_color: str = "#f1efe8"


class AppSettings(BaseModel):
    theme_settings: ThemeSettings = ThemeSettings()
    dark_mode: bool = True
    notifications: bool = True
    num_operations: int = 50
    export_format: str = "PDF"
    include_graphs: bool = True
    compress_exports: bool = False


class DiskSpaceInfo(BaseModel):
    total_gb: float
    used_gb: float
    free_gb: float
    percent_used: float


class BackupInfo(BaseModel):
    name: str
    date: str
    size_mb: float
