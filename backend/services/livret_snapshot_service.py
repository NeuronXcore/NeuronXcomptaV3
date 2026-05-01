"""
LivretSnapshotService — gestion des snapshots (instantanés figés) du Livret comptable.

Phase 3 — un snapshot est un livret figé à une date donnée, exporté en :
  - HTML autonome (`{date}_{type}.html` dans `data/livret_snapshots/{year}/`)
  - PDF paginé (`{date}_{type}.pdf`)

Pattern fondamental :
  - `manifest.json` (lock fichier `manifest.lock`) tient l'index des snapshots.
  - 3 types : `auto_monthly` (déclenché par job mensuel) · `cloture` (hook validation
    annuelle dans check_envoi_service) · `manual` (POST utilisateur).
  - Sauvegarde GED comme `type: "rapport"`, `source_module: "livret"`.
  - `delete_snapshot` refuse `cloture` sauf `force=True` (HTTP 423 côté router).

Note : ne pas confondre avec `snapshot_service.py` qui gère les sélections nommées
d'opérations (feature `Snapshots` ad-hoc). Ce service-ci est dédié au Livret.

Cf. prompts.md/prompt-livret-comptable-phase3.md §4.2.
"""
from __future__ import annotations

import fcntl
import json
import logging
import os
import shutil
import tempfile
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from backend.core.config import (
    LIVRET_SNAPSHOTS_DIR,
    LIVRET_SNAPSHOTS_MANIFEST,
    ensure_directories,
)
from backend.models.livret import (
    CompareMode,
    LivretSnapshotMetadata,
    SnapshotTrigger,
    SnapshotType,
)

logger = logging.getLogger(__name__)


_LOCK_FILE = LIVRET_SNAPSHOTS_DIR / "manifest.lock"


# ─── Manifest I/O avec lock fichier ───────────────────────────────

@contextmanager
def _manifest_lock(blocking: bool = True):
    """Lock fichier exclusif autour des opérations sur manifest.json.

    Si `blocking=False` et le lock est déjà tenu par un autre process, lève
    `BlockingIOError` immédiatement (utilisé pour HTTP 423 "snapshot en cours").
    """
    ensure_directories()
    LIVRET_SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    fp = open(_LOCK_FILE, "w")
    try:
        flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
        fcntl.flock(fp.fileno(), flags)
        yield fp
    finally:
        try:
            fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        fp.close()


def _read_manifest_raw() -> dict:
    """Lit `manifest.json`, fallback sur `.bak` si corrompu."""
    primary = LIVRET_SNAPSHOTS_MANIFEST
    bak = primary.with_suffix(primary.suffix + ".bak")

    for path in (primary, bak):
        if not path.exists():
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "snapshots" in data:
                return data
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Manifest invalide à %s : %s", path, e)
            continue

    return {"version": 1, "snapshots": []}


def _write_manifest_raw(data: dict) -> None:
    """Écrit le manifest atomiquement + sauvegarde `.bak` du précédent."""
    primary = LIVRET_SNAPSHOTS_MANIFEST
    bak = primary.with_suffix(primary.suffix + ".bak")

    LIVRET_SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    # Sauvegarde de l'ancien manifest (best-effort)
    if primary.exists():
        try:
            shutil.copy2(primary, bak)
        except OSError as e:
            logger.warning("Impossible de sauvegarder manifest .bak : %s", e)

    # Écriture atomique : tempfile + rename
    fd, tmp_path_str = tempfile.mkstemp(
        dir=str(LIVRET_SNAPSHOTS_DIR),
        prefix=".manifest.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path_str, primary)
    except Exception:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise


def _load_snapshots() -> list[dict]:
    """Charge la liste brute des snapshots depuis manifest.json (sans validation)."""
    return list(_read_manifest_raw().get("snapshots") or [])


def _save_snapshots(snapshots: list[dict]) -> None:
    """Persiste la liste dans manifest.json (déjà sous lock)."""
    _write_manifest_raw({"version": 1, "snapshots": snapshots})


# ─── Helpers ──────────────────────────────────────────────────────

def _yesterday() -> date:
    return date.today() - timedelta(days=1)


def _safe_dt_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _snapshot_id(
    year: int,
    snapshot_date: str,
    snapshot_type: SnapshotType,
    existing_ids: set[str],
) -> str:
    """Génère un ID unique. Suffixe `_HHMMSS` en cas de collision."""
    base = f"{year}_{snapshot_date}_{snapshot_type.value}"
    if base not in existing_ids:
        return base
    # Collision le même jour — ajout timestamp court
    suffix = datetime.now().strftime("%H%M%S")
    return f"{base}_{suffix}"


def _ensure_year_dir(year: int) -> Path:
    year_dir = LIVRET_SNAPSHOTS_DIR / str(year)
    year_dir.mkdir(parents=True, exist_ok=True)
    return year_dir


def _ged_register_snapshot(
    filename: str,
    path: Path,
    title: str,
    description: str,
    year: int,
    format_type: str,  # "html" | "pdf"
    snapshot_id: str,
) -> Optional[str]:
    """Enregistre un fichier snapshot dans la GED comme `type: "rapport"`,
    `source_module: "livret"`. Retourne le `doc_id` (ou None si échec best-effort)."""
    try:
        from backend.services import ged_service

        filters = {"year": year, "month": None, "quarter": None, "categories": []}
        ged_service.register_rapport(
            filename=filename,
            path=str(path),
            title=title,
            description=description,
            filters=filters,
            format_type=format_type,
            template_id=None,
        )

        # Enrichissement metadata : source_module + report_type + snapshot_id
        metadata = ged_service.load_metadata()
        docs = metadata.get("documents", {})
        for doc_id, doc in docs.items():
            if doc.get("filename") == filename and doc.get("type") == "rapport":
                doc.setdefault("rapport_meta", {})
                doc["rapport_meta"]["source_module"] = "livret"
                doc["rapport_meta"]["report_type"] = "livret_snapshot"
                doc["rapport_meta"]["snapshot_id"] = snapshot_id
                ged_service.save_metadata(metadata)
                return doc_id
        return None
    except Exception as e:
        logger.warning("GED register snapshot %s failed: %s", filename, e)
        return None


def _ged_unregister(doc_id: Optional[str]) -> None:
    """Retire l'entrée GED si présente."""
    if not doc_id:
        return
    try:
        from backend.services import ged_service
        metadata = ged_service.load_metadata()
        docs = metadata.get("documents", {})
        if doc_id in docs:
            docs.pop(doc_id)
            ged_service.save_metadata(metadata)
    except Exception as e:
        logger.warning("GED unregister %s failed: %s", doc_id, e)


# ─── API publique ─────────────────────────────────────────────────

def list_snapshots(year: Optional[int] = None) -> list[LivretSnapshotMetadata]:
    """Liste filtrable, triée par `snapshot_date` DESC."""
    raw = _load_snapshots()
    if year is not None:
        raw = [s for s in raw if int(s.get("year", 0)) == year]
    raw.sort(key=lambda s: s.get("snapshot_date") or "", reverse=True)

    out: list[LivretSnapshotMetadata] = []
    for s in raw:
        try:
            out.append(LivretSnapshotMetadata(**s))
        except Exception as e:
            logger.warning("Snapshot manifest invalide ignoré (id=%s) : %s", s.get("id"), e)
    return out


def get_snapshot(snapshot_id: str) -> Optional[LivretSnapshotMetadata]:
    """Retourne les métadonnées d'un snapshot ou None si absent."""
    for s in _load_snapshots():
        if s.get("id") == snapshot_id:
            try:
                return LivretSnapshotMetadata(**s)
            except Exception:
                return None
    return None


def get_snapshot_html_path(snapshot_id: str) -> Optional[Path]:
    """Chemin disque du fichier HTML d'un snapshot, ou None."""
    meta = get_snapshot(snapshot_id)
    if meta is None:
        return None
    p = LIVRET_SNAPSHOTS_DIR / str(meta.year) / meta.html_filename
    return p if p.exists() else None


def get_snapshot_pdf_path(snapshot_id: str) -> Optional[Path]:
    """Chemin disque du fichier PDF d'un snapshot, ou None."""
    meta = get_snapshot(snapshot_id)
    if meta is None:
        return None
    p = LIVRET_SNAPSHOTS_DIR / str(meta.year) / meta.pdf_filename
    return p if p.exists() else None


def latest_snapshot(year: int) -> Optional[LivretSnapshotMetadata]:
    """Retourne le snapshot le plus récent pour `year` (par snapshot_date), ou None."""
    snaps = list_snapshots(year)
    return snaps[0] if snaps else None


def create_snapshot(
    year: int,
    snapshot_type: SnapshotType = SnapshotType.MANUAL,
    comment: Optional[str] = None,
    as_of_date: Optional[date] = None,
    trigger: Optional[SnapshotTrigger] = None,
    include_comparison: Optional[CompareMode] = None,
) -> LivretSnapshotMetadata:
    """Crée un snapshot pour `year` à `as_of_date` (défaut hier).

    Étapes :
      1. Build du livret figé.
      2. Génération HTML autonome + PDF paginé.
      3. Mise à jour atomique du manifest (sous lock).
      4. Enregistrement GED.

    Lève `BlockingIOError` si un autre snapshot est en cours pour cette année.
    Lève `ValueError` pour année future.
    Lève `RuntimeError` si la génération échoue (cleanup partiel inclus).
    """
    today = date.today()
    if year > today.year:
        raise ValueError(f"Impossible de figer une année non débutée ({year} > {today.year})")

    if as_of_date is None:
        as_of_date = _yesterday()
        if as_of_date.year > year:
            as_of_date = date(year, 12, 31)
    elif as_of_date.year > year:
        as_of_date = date(year, 12, 31)

    if trigger is None:
        trigger_map: dict[SnapshotType, SnapshotTrigger] = {
            SnapshotType.AUTO_MONTHLY: "scheduler",
            SnapshotType.CLOTURE: "cloture_hook",
            SnapshotType.MANUAL: "manual_user",
        }
        trigger = trigger_map[snapshot_type]

    snapshot_date = today.isoformat()  # date de figeage = aujourd'hui

    try:
        with _manifest_lock(blocking=False):
            return _create_snapshot_locked(
                year=year,
                snapshot_type=snapshot_type,
                trigger=trigger,
                comment=comment,
                as_of_date=as_of_date,
                snapshot_date=snapshot_date,
                include_comparison=include_comparison,
            )
    except BlockingIOError:
        raise BlockingIOError(
            "Un snapshot est déjà en cours de génération. Réessayez dans quelques secondes."
        )


def _create_snapshot_locked(
    year: int,
    snapshot_type: SnapshotType,
    trigger: SnapshotTrigger,
    comment: Optional[str],
    as_of_date: date,
    snapshot_date: str,
    include_comparison: Optional[CompareMode] = None,
) -> LivretSnapshotMetadata:
    """Implémentation sous lock — ne pas appeler directement."""
    from backend.services import livret_html_generator, livret_pdf_generator, livret_service

    existing = _load_snapshots()
    existing_ids = {s.get("id") for s in existing}
    sid = _snapshot_id(year, snapshot_date, snapshot_type, existing_ids)  # type: ignore[arg-type]

    # Cas particulier clôture : suffixer v2/v3 si une cloture existe déjà.
    if snapshot_type == SnapshotType.CLOTURE:
        cloture_count = sum(
            1 for s in existing
            if s.get("year") == year and s.get("type") == SnapshotType.CLOTURE.value
        )
        if cloture_count > 0:
            sid = f"{year}_{snapshot_date}_{snapshot_type.value}_v{cloture_count + 1}"
            while sid in existing_ids:
                cloture_count += 1
                sid = f"{year}_{snapshot_date}_{snapshot_type.value}_v{cloture_count + 1}"

    year_dir = _ensure_year_dir(year)
    suffix_for_files = sid.replace(f"{year}_", "", 1)
    html_filename = f"{suffix_for_files}.html"
    pdf_filename = f"{suffix_for_files}.pdf"
    html_path = year_dir / html_filename
    pdf_path = year_dir / pdf_filename

    # 1) Build livret figé (avec comparaison embarquée si demandée)
    livret = livret_service.build_livret(
        year=year,
        as_of_date=as_of_date,
        snapshot_id=sid,
        compare_n1=include_comparison,
    )

    # 2) HTML autonome
    try:
        html_bytes = livret_html_generator.render(
            livret=livret,
            snapshot_id=sid,
            snapshot_type=snapshot_type,
            snapshot_date=snapshot_date,
            comment=comment,
        )
    except Exception as e:
        raise RuntimeError(f"HTML generation failed: {e}") from e

    if len(html_bytes) > 50 * 1024 * 1024:
        raise RuntimeError(f"HTML snapshot trop volumineux ({len(html_bytes) // 1024} Ko, max 50 Mo)")
    large = len(html_bytes) > 5 * 1024 * 1024

    try:
        html_path.write_bytes(html_bytes)
    except OSError as e:
        raise RuntimeError(f"HTML write failed: {e}") from e

    # 3) PDF paginé
    try:
        pdf_bytes = livret_pdf_generator.render(
            livret=livret,
            snapshot_id=sid,
            snapshot_type=snapshot_type,
            snapshot_date=snapshot_date,
            comment=comment,
        )
    except Exception as e:
        try:
            html_path.unlink()
        except OSError:
            pass
        raise RuntimeError(f"PDF generation failed: {e}") from e

    try:
        pdf_path.write_bytes(pdf_bytes)
    except OSError as e:
        try:
            html_path.unlink()
        except OSError:
            pass
        raise RuntimeError(f"PDF write failed: {e}") from e

    # 4) GED — best effort
    title_label_map = {
        SnapshotType.AUTO_MONTHLY: "Auto mensuel",
        SnapshotType.CLOTURE: "Clôture",
        SnapshotType.MANUAL: "Manuel",
    }
    title_label = title_label_map[snapshot_type]
    title_html = f"Livret {year} — Instantané {snapshot_date} ({title_label})"
    title_pdf = title_html
    description = comment or f"Snapshot {snapshot_type.value} du livret {year}"

    ged_html_id = _ged_register_snapshot(
        filename=html_filename,
        path=html_path,
        title=title_html,
        description=description,
        year=year,
        format_type="html",
        snapshot_id=sid,
    )
    ged_pdf_id = _ged_register_snapshot(
        filename=pdf_filename,
        path=pdf_path,
        title=title_pdf,
        description=description,
        year=year,
        format_type="pdf",
        snapshot_id=sid,
    )

    # 5) ytd_metrics (lecture rapide hors recompute)
    ytd_metrics: dict[str, float] = {}
    try:
        chap_01 = livret.chapters.get("01")
        if chap_01 and getattr(chap_01, "synthese", None):
            for m in chap_01.synthese.metrics:  # type: ignore[attr-defined]
                lab = m.label.lower()
                if lab.startswith("recettes"):
                    ytd_metrics["recettes"] = m.value
                elif lab.startswith("charges"):
                    ytd_metrics["charges"] = m.value
                elif lab.startswith("bnc ytd"):
                    ytd_metrics["bnc"] = m.value
    except Exception:
        pass

    metadata = LivretSnapshotMetadata(
        id=sid,
        year=year,
        snapshot_date=snapshot_date,
        type=snapshot_type,
        trigger=trigger,
        as_of_date=as_of_date.isoformat(),
        html_filename=html_filename,
        pdf_filename=pdf_filename,
        html_size=html_path.stat().st_size,
        pdf_size=pdf_path.stat().st_size,
        comment=comment,
        data_sources=dict(livret.metadata.data_sources),
        ytd_metrics=ytd_metrics,
        created_at=_safe_dt_iso(),
        ged_document_ids={"html": ged_html_id, "pdf": ged_pdf_id},
        large=large,
        comparison_mode=include_comparison,
    )

    # 6) Mise à jour manifest
    snapshots = _load_snapshots()
    snapshots.append(metadata.model_dump(mode="json"))
    _save_snapshots(snapshots)

    logger.info("Livret snapshot %s créé (HTML %d Ko, PDF %d Ko)",
                sid, metadata.html_size // 1024, metadata.pdf_size // 1024)

    return metadata


def delete_snapshot(snapshot_id: str, force: bool = False) -> dict:
    """Supprime un snapshot (fichiers + entrée manifest + entrées GED).

    Refuse les snapshots `cloture` sauf `force=True`. Retourne un récap.
    Lève `PermissionError` si refus, `KeyError` si absent.
    """
    with _manifest_lock(blocking=True):
        snapshots = _load_snapshots()
        idx = next((i for i, s in enumerate(snapshots) if s.get("id") == snapshot_id), None)
        if idx is None:
            raise KeyError(f"Snapshot inconnu : {snapshot_id}")

        snap = snapshots[idx]
        if snap.get("type") == SnapshotType.CLOTURE.value and not force:
            raise PermissionError(
                "Snapshot de clôture protégé. Utiliser ?force=true pour confirmer la suppression."
            )

        year = int(snap.get("year", 0))
        year_dir = LIVRET_SNAPSHOTS_DIR / str(year)
        html_path = year_dir / snap.get("html_filename", "")
        pdf_path = year_dir / snap.get("pdf_filename", "")

        removed = {"html": False, "pdf": False}
        for path, key in ((html_path, "html"), (pdf_path, "pdf")):
            if path.exists():
                try:
                    path.unlink()
                    removed[key] = True
                except OSError as e:
                    logger.warning("Suppression %s échouée : %s", path, e)

        ged_ids = snap.get("ged_document_ids") or {}
        _ged_unregister(ged_ids.get("html"))
        _ged_unregister(ged_ids.get("pdf"))

        snapshots.pop(idx)
        _save_snapshots(snapshots)

        return {
            "deleted": True,
            "snapshot_id": snapshot_id,
            "files_removed": removed,
        }


# ─── Helpers année active (pour le job mensuel) ────────────────────

def active_years() -> list[int]:
    """Liste les années pour lesquelles au moins un fichier ops existe."""
    from backend.services import operation_service

    try:
        files = operation_service.list_operation_files()
    except Exception:
        return [date.today().year]
    years = sorted({f.get("year") for f in files if f.get("year")}, reverse=True)
    return years or [date.today().year]


def has_auto_snapshot_for_period(year: int, period_yyyymm: str) -> bool:
    """True si un snapshot `auto_monthly` existe déjà pour `year` dans le mois donné.

    Utilisé par le job mensuel pour idempotence après restart asyncio.
    """
    for s in _load_snapshots():
        if s.get("year") != year:
            continue
        if s.get("type") != SnapshotType.AUTO_MONTHLY.value:
            continue
        sd = s.get("snapshot_date") or ""
        if sd.startswith(period_yyyymm):
            return True
    return False


def last_day_of_previous_month(today: date) -> date:
    """Retourne le dernier jour du mois précédent `today`."""
    first_of_this_month = today.replace(day=1)
    return first_of_this_month - timedelta(days=1)


def first_day_of_next_month(today: date) -> date:
    """Retourne le 1er du mois suivant `today` (utilisé par le job pour calculer next-fire)."""
    if today.month == 12:
        return date(today.year + 1, 1, 1)
    return date(today.year, today.month + 1, 1)


def auto_monthly_job_once() -> dict:
    """Exécute un tick du job mensuel : crée un snapshot `auto_monthly` pour
    toutes les années actives n'en ayant pas déjà un dans le mois courant.

    Retourne `{created: [...ids], skipped: [...years], errors: [...{year, error}]}`.
    Idempotent — réappel sûr (skip via has_auto_snapshot_for_period).
    """
    today = date.today()
    period_yyyymm = today.strftime("%Y-%m")
    as_of = last_day_of_previous_month(today)

    created: list[str] = []
    skipped: list[int] = []
    errors: list[dict] = []

    for year in active_years():
        if has_auto_snapshot_for_period(year, period_yyyymm):
            skipped.append(year)
            continue
        try:
            meta = create_snapshot(
                year=year,
                snapshot_type=SnapshotType.AUTO_MONTHLY,
                as_of_date=as_of,
                trigger="scheduler",
            )
            created.append(meta.id)
        except Exception as e:
            logger.error("auto_monthly_job: snapshot %s failed: %s", year, e)
            errors.append({"year": year, "error": str(e)})

    logger.info("auto_monthly_job done — created=%s skipped=%s errors=%s",
                len(created), len(skipped), len(errors))
    return {"created": created, "skipped": skipped, "errors": errors}
