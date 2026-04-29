"""
NeuronXcompta V3 - FastAPI Backend
Point d'entrée principal de l'API.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.core.config import APP_NAME, APP_VERSION, ASSETS_DIR, LOGS_DIR, ensure_directories, migrate_imports_directory
from backend.core.shutdown import shutdown_event
from backend.routers import operations, categories, ml, analytics, settings, reports, queries, justificatifs, ocr, exports, rapprochement, lettrage, cloture, sandbox, alertes, ged, amortissements, simulation, templates, previsionnel, tasks, ventilation, email, charges_forfaitaires, snapshots, liasse_scp, check_envoi
from backend.services.sandbox_service import (
    scan_existing_sandbox_arrivals,
    seed_recent_events_from_disk,
    start_sandbox_watchdog,
    stop_sandbox_watchdog,
)

# Initialiser les répertoires et migrer les fichiers existants
ensure_directories()
migrate_imports_directory()

# Configurer le logging
log_file = LOGS_DIR / "app.log"
file_handler = RotatingFileHandler(
    str(log_file), maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
file_handler.setFormatter(formatter)
logging.getLogger().addHandler(file_handler)
logging.getLogger().setLevel(logging.INFO)

# Background task — previsionnel scan periodique
async def _previsionnel_background_loop():
    """Refresh echeances + scan matching toutes les heures.

    Sleep interrompable via shutdown_event — sortie sub-seconde au shutdown
    uvicorn au lieu d'attendre la fin du sleep(3600).
    """
    import datetime

    # Sleep de démarrage — sortable si shutdown avant les 30s
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=30)
        return  # event set pendant l'attente → shutdown, on sort
    except asyncio.TimeoutError:
        pass  # 30s écoulées, on démarre normalement

    while not shutdown_event.is_set():
        try:
            from backend.services import previsionnel_service
            year = datetime.date.today().year
            previsionnel_service.refresh_echeances(year)
            previsionnel_service.update_statuts_retard()
            previsionnel_service.scan_matching()
            previsionnel_service.scan_all_prelevements(year)
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Previsionnel background scan error: {e}"
            )

        # Sleep interrompable — sort immédiatement si shutdown_event set
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=3600)
            break  # event set → sortir de la boucle
        except asyncio.TimeoutError:
            pass  # tick normal — itération suivante

_prev_task = None
_sandbox_auto_task = None
_check_envoi_task = None
_manual_zips_cleanup_task = None


# Background task — cleanup quotidien des ZIPs manuels non envoyés > 30j
async def _manual_zips_cleanup_loop():
    """Purge quotidienne des ZIPs manuels expirés (> 30 jours, non envoyés).

    Sleep coopératif via shutdown_event. Délai initial 5min pour laisser le
    backend démarrer proprement, puis tick 24h.
    """
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=300)
        return
    except asyncio.TimeoutError:
        pass

    while not shutdown_event.is_set():
        try:
            from backend.services import email_service
            removed = email_service.cleanup_old_manual_zips(max_age_days=30)
            if removed > 0:
                logging.getLogger(__name__).info(
                    "Manual zips cleanup: %d ZIP(s) supprimé(s) (>30j non envoyés)",
                    removed,
                )
        except Exception as e:
            logging.getLogger(__name__).warning(f"Manual zips cleanup error: {e}")
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=86400)
            break
        except asyncio.TimeoutError:
            pass


# Background task — recalcul quotidien des reminders Check d'envoi
async def _check_envoi_reminder_loop():
    """Recalcule les niveaux de reminder Check d'envoi toutes les heures.

    - Pour chaque (year, month) entre N-1 mois et N+0, calcule le `level`
      via `_compute_level()` et met à jour `data/check_envoi/reminders.json`.
    - Supprime les entrées des instances désormais validées.

    Sleep coopératif via shutdown_event (cf. CLAUDE.md, contrat strict).
    """
    # Sleep de démarrage — sortable si shutdown avant les 60s
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=60)
        return
    except asyncio.TimeoutError:
        pass

    while not shutdown_event.is_set():
        try:
            from backend.services import check_envoi_service
            written = check_envoi_service.daily_recompute_reminders()
            if written:
                logging.getLogger(__name__).info(
                    "Check d'envoi reminders : %d entrée(s) mise(s) à jour", written
                )
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Check envoi reminder loop error: {e}"
            )
        # Sleep interrompable : 1h
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=3600)
            break
        except asyncio.TimeoutError:
            pass


def _seed_dotations_amortissements_category() -> None:
    """Seed idempotent : ajoute la catégorie 'Dotations aux amortissements' si absente.

    Cette catégorie est consommée par la ligne virtuelle injectée dans le dashboard
    (analytics) et future ligne d'OD (Prompt B). Elle est exclue de `charges_pro` via
    `EXCLUDED_FROM_CHARGES_PRO`.
    """
    log = logging.getLogger(__name__)
    try:
        from backend.services import category_service
        existing = category_service.load_categories() or []
        names = {c.get("Catégorie") for c in existing}
        if "Dotations aux amortissements" not in names:
            category_service.add_category(
                name="Dotations aux amortissements",
                color="#3C3489",
                sous_categorie=None,
            )
            log.info("✓ Catégorie 'Dotations aux amortissements' ajoutée")
    except Exception as e:
        log.warning(f"Seed catégorie Dotations: {e}")


def _migrate_amortissement_config() -> None:
    """Migration idempotente : config.json + immobilisations.json vers le nouveau format.

    Config :
      - seuil_immobilisation → seuil (cast float)
      - suppression de methode_par_defaut, categories_immobilisables, exercice_cloture

    Immobilisations :
      - libelle → designation, valeur_origine → base_amortissable, duree_amortissement → duree
      - methode → mode (forcé `lineaire` si `degressif` — interdit en BNC régime recettes)
      - poste_comptable → poste, quote_part_pro cast float
      - ajout champs reprise (exercice_entree_neuronx, amortissements_anterieurs, vnc_ouverture)
    """
    from backend.core.config import AMORTISSEMENTS_DIR

    log = logging.getLogger(__name__)

    # 1) Migration config.json
    config_path = AMORTISSEMENTS_DIR / "config.json"
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            data = None
        if isinstance(data, dict):
            changed = False
            if "seuil_immobilisation" in data and "seuil" not in data:
                try:
                    data["seuil"] = float(data.pop("seuil_immobilisation"))
                except (ValueError, TypeError):
                    data["seuil"] = 500.0
                    data.pop("seuil_immobilisation", None)
                changed = True
            elif "seuil" in data and not isinstance(data["seuil"], float):
                try:
                    data["seuil"] = float(data["seuil"])
                    changed = True
                except (ValueError, TypeError):
                    pass
            for k in ("methode_par_defaut", "categories_immobilisables", "exercice_cloture"):
                if k in data:
                    del data[k]
                    changed = True
            if changed:
                config_path.write_text(
                    json.dumps(data, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                log.info("✓ amortissements/config.json migré (nouveau format)")

    # 2) Migration immobilisations.json
    immos_path = AMORTISSEMENTS_DIR / "immobilisations.json"
    if not immos_path.exists():
        return
    try:
        immos_data = json.loads(immos_path.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(immos_data, list):
        return

    rename_map = {
        "libelle": "designation",
        "valeur_origine": "base_amortissable",
        "duree_amortissement": "duree",
        "methode": "mode",
        "poste_comptable": "poste",
    }

    renamed = 0
    forced_lineaire = 0
    added_reprise = 0

    for immo in immos_data:
        if not isinstance(immo, dict):
            continue
        for old, new in rename_map.items():
            if old in immo:
                if new not in immo:
                    immo[new] = immo.pop(old)
                    renamed += 1
                else:
                    # Les deux sont présents : conserver le nouveau, jeter l'ancien
                    del immo[old]
        # Cast quote_part_pro en float
        if "quote_part_pro" in immo:
            try:
                immo["quote_part_pro"] = float(immo["quote_part_pro"])
            except (ValueError, TypeError):
                immo["quote_part_pro"] = 100.0
        # Force mode lineaire
        if immo.get("mode") == "degressif":
            immo["mode"] = "lineaire"
            forced_lineaire += 1
        # Ajout champs reprise par défaut
        if "exercice_entree_neuronx" not in immo:
            immo["exercice_entree_neuronx"] = None
            immo["amortissements_anterieurs"] = float(immo.get("amortissements_anterieurs", 0.0) or 0.0)
            immo["vnc_ouverture"] = None
            added_reprise += 1

    if renamed or forced_lineaire or added_reprise:
        immos_path.write_text(
            json.dumps(immos_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if renamed:
            log.info(f"✓ {renamed} champ(s) immobilisation renommé(s) (libelle→designation, etc.)")
        if forced_lineaire:
            log.info(f"✓ {forced_lineaire} immo(s) migrée(s) dégressif → linéaire")
        if added_reprise:
            log.info(f"✓ {added_reprise} immo(s) enrichie(s) avec champs reprise (None par défaut)")


def _migrate_forfait_sources_and_links() -> None:
    """Migration idempotente des OD forfaits blanchissage / repas.

    Pour chaque op `type_operation == "OD"` dans data/imports/operations/*.json :
      - Si `Catégorie == "Blanchissage professionnel"` ET `source` vide → set `source = "blanchissage"`.
      - Si `Catégorie == "Repas pro"` ET `Sous-catégorie == "Repas seul"` ET `source` vide → set `source = "repas"`.
      - Si `Lien justificatif` vide ET source identifiée → cherche le PDF rapport dans
        `data/reports/` par pattern (`blanchissage_{year}_*.pdf` ou `repas_{year}_*.pdf`)
        et restaure `Lien justificatif = "reports/{filename}"` + `Justificatif = True`.

    Skip silencieux si tout est déjà cohérent. Pas de risque de re-clear par
    `apply_link_repair` car `_collect_referenced_justificatifs` préserve désormais
    les paths `reports/...` pointant vers un PDF existant.
    """
    from backend.core.config import IMPORTS_OPERATIONS_DIR, REPORTS_DIR  # noqa: F401 (REPORTS_DIR utilisé en phase 2)
    log = logging.getLogger(__name__)
    ops_dir = Path(IMPORTS_OPERATIONS_DIR)
    if not ops_dir.exists():
        return

    sources_added = 0
    links_restored = 0

    def _find_report_pdf(source: str, year: int) -> Optional[str]:
        """Cherche un PDF rapport dans data/reports/ par préfixe `source_YYYY*.pdf`.

        Pattern réel : `blanchissage_YYYYMMDD_montant.pdf` ou
        `repas_YYYYMMDD_montant.pdf` (cf. charges_forfaitaires_service).
        Le glob `{source}_{year}*.pdf` capture `{source}_{year}1231_*.pdf` et
        s'aligne sur le fallback de `get_forfaits_generes()`.
        """
        if not REPORTS_DIR.exists():
            return None
        candidates = sorted(REPORTS_DIR.glob(f"{source}_{year}*.pdf"))
        if not candidates:
            return None
        # En cas de multiples (regen historique), prendre le plus récent (mtime)
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return candidates[0].name

    for fp in ops_dir.glob("operations_*.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        changed = False
        for op in data:
            if op.get("type_operation") != "OD":
                continue

            cat = op.get("Catégorie") or ""
            sub = op.get("Sous-catégorie") or ""

            forfait_source: Optional[str] = None
            if cat == "Blanchissage professionnel":
                forfait_source = "blanchissage"
            elif cat == "Repas pro" and sub == "Repas seul":
                forfait_source = "repas"
            else:
                continue

            # 1. Pose source si vide
            if not (op.get("source") or "").strip():
                op["source"] = forfait_source
                sources_added += 1
                changed = True

            # 2. Restaure Lien justificatif si vide
            current_link = (op.get("Lien justificatif") or "").strip()
            if not current_link:
                date_str = (op.get("Date") or "")
                try:
                    year = int(date_str[:4])
                except (ValueError, TypeError):
                    continue
                pdf_name = _find_report_pdf(forfait_source, year)
                if pdf_name:
                    op["Lien justificatif"] = f"reports/{pdf_name}"
                    op["Justificatif"] = True
                    links_restored += 1
                    changed = True

        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    if sources_added or links_restored:
        log.info(
            f"Migration OD forfaits: sources={sources_added} ajoutées, "
            f"liens={links_restored} restaurés"
        )

    # Phase 2 : OD signalétique véhicule pour les barèmes déjà appliqués.
    # Le véhicule ne créait historiquement aucune OD bancaire ; on en crée une
    # signalétique (Débit=0/Crédit=0) pour rendre le PDF rapport visible dans
    # Édition/Justificatifs au même titre que blanchissage/repas. La déduction
    # comptable continue de passer par le ratio sur poste GED `vehicule`.
    try:
        from backend.core.config import BAREMES_DIR
        from backend.services.charges_forfaitaires_service import ChargesForfaitairesService
        if BAREMES_DIR.exists():
            service: Optional[ChargesForfaitairesService] = None
            for bareme_fp in sorted(BAREMES_DIR.glob("vehicule_*.json")):
                try:
                    bareme = json.loads(bareme_fp.read_text(encoding="utf-8"))
                except Exception:
                    continue
                ratio = bareme.get("ratio_pro_applique")
                date_app = bareme.get("date_derniere_application")
                if ratio is None or not date_app:
                    continue
                # Extraire l'année du filename : vehicule_YYYY.json
                try:
                    year_str = bareme_fp.stem.split("_", 1)[1]
                    year = int(year_str)
                except (IndexError, ValueError):
                    continue
                pdf_filename = f"quote_part_vehicule_{year}.pdf"
                pdf_path = REPORTS_DIR / pdf_filename
                if not pdf_path.exists():
                    continue
                if service is None:
                    service = ChargesForfaitairesService()
                # _create_or_update est idempotent (skip si déjà cohérent)
                pre = service._find_vehicule_od(year)
                service._create_or_update_vehicule_od(year, float(ratio), pdf_filename)
                if pre is None:
                    log.info(f"OD signalétique véhicule {year} créée (ratio {ratio:.0f}%)")
    except Exception as e:
        log.warning(f"Migration OD signalétique véhicule échouée: {e}")


def _migrate_repas_to_repas_pro() -> None:
    """Migration one-shot : 'repas' → 'Repas pro' + sous-cat 'Repas seul' dans les opérations."""
    from backend.core.config import IMPORTS_OPERATIONS_DIR
    log = logging.getLogger(__name__)
    ops_dir = Path(IMPORTS_OPERATIONS_DIR)
    if not ops_dir.exists():
        return
    total_migrated = 0
    for fp in ops_dir.glob("*.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        changed = False
        for op in data:
            if op.get("Catégorie") == "repas":
                op["Catégorie"] = "Repas pro"
                if not op.get("Sous-catégorie"):
                    op["Sous-catégorie"] = "Repas seul"
                changed = True
                total_migrated += 1
        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if total_migrated > 0:
        log.info(f"Migration repas→Repas pro: {total_migrated} opérations mises à jour")

    # Phase 2 : UBER EATS → perso (food delivery = personnel)
    uber_migrated = 0
    for fp in ops_dir.glob("*.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        changed = False
        for op in data:
            lib = (op.get("Libellé") or "").upper()
            if ("UBER" in lib and "EATS" in lib) or "UBEREATS" in lib.replace(" ", ""):
                if op.get("Catégorie") != "perso" or op.get("Sous-catégorie") != "Repas":
                    op["Catégorie"] = "perso"
                    op["Sous-catégorie"] = "Repas"
                    changed = True
                    uber_migrated += 1
        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if uber_migrated > 0:
        log.info(f"Migration UBER EATS→perso: {uber_migrated} opérations mises à jour")


# Lifespan — démarrage/arrêt du sandbox watchdog + previsionnel
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _prev_task, _check_envoi_task
    # Seed arrivals in-memory depuis sandbox/ AVANT de démarrer le watchdog
    # (préserve les mtime originaux, évite qu'ils soient écrasés par datetime.now()
    # si `_process_file` tombe sur ces mêmes fichiers pendant process_existing_files).
    try:
        scan_existing_sandbox_arrivals()
    except Exception as e:
        logging.getLogger(__name__).warning("scan_existing_sandbox_arrivals: %s", e)
    start_sandbox_watchdog()
    # Rejeu des events sandbox récents (fenêtre 180s) — rattrape les reloads uvicorn
    try:
        seed_recent_events_from_disk()
    except Exception as e:
        logging.getLogger(__name__).warning("seed_recent_events_from_disk: %s", e)
    # Réconciliation index rapports
    from backend.services.report_service import reconcile_index
    reconcile_index()
    # Migration idempotente des OD forfaits (source + lien rapport restauré)
    # — DOIT être appelée AVANT apply_link_repair pour fournir un état stable
    # à la passe de réparation.
    try:
        _migrate_forfait_sources_and_links()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Migration OD forfaits error: {e}")
    # Réparation silencieuse des liens justificatifs (duplicatas, orphelins, ghosts)
    try:
        from backend.services import justificatif_service
        repair_result = justificatif_service.apply_link_repair()
        total_touched = (
            repair_result["deleted_from_attente"]
            + repair_result["moved_to_traites"]
            + repair_result["deleted_from_traites"]
            + repair_result["moved_to_attente"]
            + repair_result["ghost_refs_cleared"]
        )
        if total_touched > 0:
            logging.getLogger(__name__).info(
                f"Justificatifs link repair: "
                f"{repair_result['moved_to_traites']} moves→traites, "
                f"{repair_result['moved_to_attente']} moves→en_attente, "
                f"{repair_result['deleted_from_attente'] + repair_result['deleted_from_traites']} dup supprimés, "
                f"{repair_result['ghost_refs_cleared']} ghosts clearés, "
                f"{repair_result['conflicts_skipped']} conflits skippés"
            )
        elif repair_result["conflicts_skipped"] > 0:
            logging.getLogger(__name__).warning(
                f"Justificatifs: {repair_result['conflicts_skipped']} conflits de hash à résoudre manuellement "
                "(voir GET /api/justificatifs/scan-links)"
            )
    except Exception as e:
        logging.getLogger(__name__).warning(f"Justificatifs link repair error: {e}")
    # Log-only : justificatifs pseudo-canoniques (ancienne regex permissive)
    # Ces fichiers étaient silencieusement classés `already_canonical` avant le
    # durcissement de CANONICAL_RE. Aucun rename automatique — le prochain passage
    # dans ScanRenameDrawer les proposera à l'utilisateur.
    try:
        from backend.services import rename_service
        from backend.core.config import (
            JUSTIFICATIFS_EN_ATTENTE_DIR,
            JUSTIFICATIFS_TRAITES_DIR,
        )
        legacy_pseudo = rename_service.find_legacy_pseudo_canonical(
            [JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR]
        )
        if legacy_pseudo:
            logging.getLogger(__name__).info(
                f"Justificatifs pseudo-canoniques détectés ({len(legacy_pseudo)}) — "
                f"proposés au rename via ScanRenameDrawer. Exemples : "
                f"{', '.join(legacy_pseudo[:3])}"
                f"{'…' if len(legacy_pseudo) > 3 else ''}"
            )
    except Exception as e:
        logging.getLogger(__name__).warning(f"Scan pseudo-canonique error: {e}")
    # Migration one-shot : repas → Repas pro + Repas seul
    try:
        _migrate_repas_to_repas_pro()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Migration repas→Repas pro error: {e}")
    # Seed catégorie 'Dotations aux amortissements' (idempotent)
    try:
        _seed_dotations_amortissements_category()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Seed catégorie Dotations error: {e}")
    # Migration amortissements (config.json + immobilisations.json) — idempotente
    try:
        _migrate_amortissement_config()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Migration amortissements error: {e}")
    # Auto-split CSG/CRDS sur ops URSSAF (N-2 + N-1 + N) — idempotent, ~50ms/op,
    # garantit que charges_pro et BNC sont à jour sans action utilisateur.
    try:
        import datetime
        from backend.services import fiscal_service
        log = logging.getLogger(__name__)
        current_year = datetime.date.today().year
        for year in (current_year - 2, current_year - 1, current_year):
            result = fiscal_service.run_batch_csg_split(year=year, force=False)
            if result["updated"] > 0:
                log.info(
                    "CSG/CRDS auto-split %s: %d ops calculées "
                    "(non-déductible total %.2f €)",
                    year, result["updated"], result["total_non_deductible"],
                )
    except Exception as e:
        logging.getLogger(__name__).warning(f"CSG/CRDS auto-split au boot: {e}")
    # Preload EasyOCR en arrière-plan (non-bloquant) — élimine le cold start
    # de ~20-30s sur le 1er OCR après boot. Le thread daemon loade le modèle
    # pendant que le backend commence à servir les requêtes.
    try:
        from backend.services.ocr_service import preload_reader_async
        preload_reader_async()
    except Exception as e:
        logging.getLogger(__name__).warning("EasyOCR preload: %s", e)
    # Créer data/exports/manual/ si absent (pour mode envoi manuel)
    try:
        from backend.services import email_service
        email_service.ensure_manual_dirs()
    except Exception as e:
        logging.getLogger(__name__).warning(f"ensure_manual_dirs error: {e}")
    # Demarrer la tache previsionnel en arriere-plan
    _prev_task = asyncio.create_task(_previsionnel_background_loop())
    # Démarrer la loop check d'envoi reminders (1h)
    _check_envoi_task = asyncio.create_task(_check_envoi_reminder_loop())
    # Démarrer la loop auto-processor sandbox (no-op si sandbox_auto_mode=False)
    global _sandbox_auto_task, _manual_zips_cleanup_task
    try:
        from backend.services.sandbox_auto_processor import auto_processor_loop
        _sandbox_auto_task = asyncio.create_task(auto_processor_loop())
    except Exception as e:
        logging.getLogger(__name__).warning("sandbox_auto_processor: %s", e)
    # Démarrer la loop cleanup quotidien des ZIPs manuels (24h)
    _manual_zips_cleanup_task = asyncio.create_task(_manual_zips_cleanup_loop())
    yield

    # === SHUTDOWN ===
    log = logging.getLogger(__name__)

    # 1. Signal coopératif — débloque les boucles qui checkent shutdown_event
    shutdown_event.set()

    # 2. Stop watchdog (thread) avec join borné à 1s — voir stop_sandbox_watchdog
    try:
        stop_sandbox_watchdog()
    except Exception as e:
        log.warning("stop_sandbox_watchdog error: %s", e)

    # 3. Cancel + await tasks asyncio avec timeout global de 1.5s
    tasks = [t for t in (_prev_task, _sandbox_auto_task, _check_envoi_task, _manual_zips_cleanup_task) if t is not None]
    for t in tasks:
        t.cancel()
    if tasks:
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=1.5,
            )
        except asyncio.TimeoutError:
            log.warning(
                "Shutdown: %d background task(s) non terminée(s) en 1.5s — "
                "uvicorn les killera",
                sum(1 for t in tasks if not t.done()),
            )


# Créer l'app FastAPI
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="API backend pour NeuronXcompta - Assistant Comptable IA",
    lifespan=lifespan,
)

# CORS - autoriser le frontend React (Vite dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Monter les routers
app.include_router(operations.router)
app.include_router(categories.router)
app.include_router(ml.router)
app.include_router(analytics.router)
app.include_router(settings.router)
app.include_router(reports.router)
app.include_router(queries.router)
app.include_router(justificatifs.router)
app.include_router(ocr.router)
app.include_router(exports.router)
app.include_router(rapprochement.router)
app.include_router(lettrage.router)
app.include_router(cloture.router)
app.include_router(sandbox.router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(alertes.router)
app.include_router(ged.router)
app.include_router(amortissements.router)
app.include_router(simulation.router)
app.include_router(templates.router)
app.include_router(previsionnel.router)
app.include_router(tasks.router)
app.include_router(ventilation.router)
app.include_router(email.router)
app.include_router(charges_forfaitaires.router)
app.include_router(snapshots.router)
app.include_router(liasse_scp.router)
app.include_router(check_envoi.router)

# Servir les assets statiques (logos, images de marque) depuis backend/assets/
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


@app.get("/")
async def root():
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health():
    return {"status": "ok"}
