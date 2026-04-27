"""Service d'envoi d'emails pour les documents comptables."""
from __future__ import annotations

import logging
import os
import re
import smtplib
import tempfile
import zipfile
from datetime import datetime
from email import encoders
from email.mime.base import MIMEBase
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from backend.core.config import (
    EXPORTS_DIR, REPORTS_DIR, RAPPORTS_DIR,
    IMPORTS_RELEVES_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR,
    GED_DIR, ASSETS_DIR,
)
from backend.models.email import DocumentRef, DocumentInfo, EmailSendResponse, EmailTestResponse

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
MAX_TOTAL_SIZE_MB = 25

# Extensions à exclure du listing
EXCLUDED_EXTENSIONS = {".json", ".png", ".ocr.json"}
EXCLUDED_SUFFIXES = [".ocr.json"]
EXCLUDED_FILENAMES = {".DS_Store", "Thumbs.db", ".gitkeep", "reports_index.json", "reports_index.json.migrated"}


def _resolve_document_path(doc: DocumentRef) -> Optional[Path]:
    """Résout le chemin physique d'un document selon son type."""
    if doc.type == "export":
        p = EXPORTS_DIR / doc.filename
        return p if p.exists() else None

    if doc.type == "rapport":
        for d in [REPORTS_DIR, RAPPORTS_DIR]:
            p = d / doc.filename
            if p.exists():
                return p
        return None

    if doc.type == "releve":
        p = IMPORTS_RELEVES_DIR / doc.filename
        return p if p.exists() else None

    if doc.type == "justificatif":
        for d in [JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR]:
            p = d / doc.filename
            if p.exists():
                return p
        return None

    if doc.type == "ged":
        # Recherche récursive dans GED_DIR
        if GED_DIR.exists():
            for root, _, files in os.walk(GED_DIR):
                if doc.filename in files:
                    p = Path(root) / doc.filename
                    # Exclure thumbnails et metadata
                    if "thumbnails" not in str(p):
                        return p
        return None

    return None


def _is_excluded(filename: str) -> bool:
    """Vérifie si un fichier doit être exclu du listing."""
    if filename in EXCLUDED_FILENAMES:
        return True
    for suf in EXCLUDED_SUFFIXES:
        if filename.endswith(suf):
            return True
    _, ext = os.path.splitext(filename)
    return ext.lower() in EXCLUDED_EXTENSIONS


def _extract_date_from_filename(filename: str) -> Optional[str]:
    """Tente d'extraire une date ISO depuis un nom de fichier."""
    # Pattern: 20260408 or 2026-04-08 or 2026_04
    m = re.search(r"(\d{4})(\d{2})(\d{2})_(\d{6})", filename)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"(\d{4})-(\d{2})", filename)
    if m:
        return f"{m.group(1)}-{m.group(2)}-01"
    m = re.search(r"_(\d{4})_", filename)
    if m:
        return f"{m.group(1)}-01-01"
    return None


def _scan_directory(
    directory: Path,
    doc_type: str,
    category: Optional[str] = None,
    recursive: bool = False,
) -> list[DocumentInfo]:
    """Scanne un répertoire et retourne les documents."""
    results = []
    if not directory.exists():
        return results

    if recursive:
        items = list(directory.rglob("*"))
    else:
        items = list(directory.iterdir())

    for f in items:
        if not f.is_file():
            continue
        if _is_excluded(f.name):
            continue
        if "thumbnails" in str(f):
            continue

        stat = f.stat()
        display = f.stem.replace("_", " ").replace("-", " ")
        if len(display) > 60:
            display = display[:57] + "..."

        results.append(DocumentInfo(
            type=doc_type,
            filename=f.name,
            display_name=display,
            size_bytes=stat.st_size,
            date=_extract_date_from_filename(f.name),
            category=category,
        ))

    return results


MONTH_NAMES_FR = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]


def _build_releve_display_map() -> dict:
    """Construit un mapping hash → 'Relevé Mois Année' depuis les fichiers d'opérations."""
    from backend.services import operation_service
    mapping: dict = {}
    try:
        op_files = operation_service.list_operation_files()
        for f in op_files:
            # Extraire le hash depuis operations_YYYYMMDD_HHMMSS_HASH.json
            m = re.search(r"_([a-f0-9]{8})\.json$", f.get("filename", ""))
            if m:
                file_hash = m.group(1)
                year = f.get("year")
                month = f.get("month")
                if year and month and 1 <= month <= 12:
                    mapping[file_hash] = f"Relevé {MONTH_NAMES_FR[month - 1]} {year}"
    except Exception:
        pass
    return mapping


def list_available_documents(
    doc_type: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> list[DocumentInfo]:
    """Liste les documents disponibles pour envoi."""
    all_docs: list[DocumentInfo] = []

    if not doc_type or doc_type == "export":
        all_docs.extend(_scan_directory(EXPORTS_DIR, "export", "Exports"))

    if not doc_type or doc_type == "rapport":
        all_docs.extend(_scan_directory(REPORTS_DIR, "rapport", "Rapports"))
        all_docs.extend(_scan_directory(RAPPORTS_DIR, "rapport", "Rapports"))

    if not doc_type or doc_type == "releve":
        releve_map = _build_releve_display_map()
        releves = _scan_directory(IMPORTS_RELEVES_DIR, "releve", "Relevés")
        for r in releves:
            m = re.match(r"pdf_([a-f0-9]+)\.pdf", r.filename)
            if m and m.group(1) in releve_map:
                display = releve_map[m.group(1)]
                r.display_name = display
                # Inject year/month into date for filtering
                parts = display.split()  # "Relevé Janvier 2025"
                if len(parts) == 3:
                    r.date = f"{parts[2]}-{MONTH_NAMES_FR.index(parts[1]) + 1:02d}-01"
        all_docs.extend(releves)

    if not doc_type or doc_type == "justificatif":
        all_docs.extend(_scan_directory(JUSTIFICATIFS_TRAITES_DIR, "justificatif", "Justificatifs"))

    if not doc_type or doc_type == "ged":
        all_docs.extend(_scan_directory(GED_DIR, "ged", "Documents GED", recursive=True))

    # Filtrer par année/mois si fournis
    if year:
        year_str = str(year)
        all_docs = [d for d in all_docs if year_str in d.filename]
    if month:
        month_patterns = [f"{month:02d}", f"-{month:02d}"]
        all_docs = [d for d in all_docs if any(p in d.filename for p in month_patterns)]

    # Dédupliquer par filename
    seen: set = set()
    deduped = []
    for d in all_docs:
        if d.filename not in seen:
            seen.add(d.filename)
            deduped.append(d)

    # Trier par date décroissante puis nom
    deduped.sort(key=lambda d: (d.date or "", d.filename), reverse=True)
    return deduped


def test_smtp_connection(smtp_user: str, smtp_password: str) -> EmailTestResponse:
    """Test la connexion SMTP sans envoyer de mail."""
    smtp_password = smtp_password.strip()
    logger.info("SMTP test: user=%s, password_length=%d", smtp_user, len(smtp_password))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_password)
        return EmailTestResponse(success=True, message="Connexion SMTP Gmail réussie")
    except smtplib.SMTPAuthenticationError as e:
        detail = str(e)
        logger.error("SMTP auth error: %s", detail)
        return EmailTestResponse(success=False, message=f"Échec authentification SMTP — {detail}")
    except Exception as e:
        detail = str(e)
        logger.error("SMTP error: %s", detail)
        return EmailTestResponse(success=False, message=f"Erreur connexion : {detail}")


TYPE_FOLDER_MAP = {
    "export": "exports",
    "rapport": "rapports",
    "releve": "releves",
    "justificatif": "justificatifs",
    "ged": "documents",
}

LOGO_PATH = ASSETS_DIR / "logo_lockup_light_400.png"
LOGO_MARK_PATH = ASSETS_DIR / "logo_mark_64.png"
LOGO_MARK_HD_PATH = ASSETS_DIR / "logo_mark_200.png"
TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

MOIS_FR = [
    "janvier", "f\u00e9vrier", "mars", "avril", "mai", "juin",
    "juillet", "ao\u00fbt", "septembre", "octobre", "novembre", "d\u00e9cembre",
]


def _create_zip(documents: list[DocumentRef], fichiers: list[Path]) -> Path:
    """Crée un ZIP temporaire contenant tous les documents organisés par type."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = Path(tempfile.gettempdir()) / f"Documents_Comptables_{timestamp}.zip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc, fpath in zip(documents, fichiers):
            folder = TYPE_FOLDER_MAP.get(doc.type, "autres")
            zf.write(str(fpath), arcname=f"{folder}/{fpath.name}")

    return zip_path


def send_email(
    smtp_user: str,
    smtp_password: str,
    nom_expediteur: Optional[str],
    destinataires: list[str],
    objet: str,
    corps: str,
    documents: list[DocumentRef],
) -> EmailSendResponse:
    """Envoie un email HTML avec logo + un seul ZIP en pièce jointe."""
    smtp_password = smtp_password.strip()

    # Résoudre les chemins
    fichiers: list[Path] = []
    for doc in documents:
        fpath = _resolve_document_path(doc)
        if not fpath:
            return EmailSendResponse(
                success=False,
                message=f"Fichier introuvable : {doc.filename} (type: {doc.type})",
                destinataires=destinataires,
                fichiers_envoyes=[],
                taille_totale_mo=0,
            )
        fichiers.append(fpath)

    # Créer le ZIP
    zip_path = _create_zip(documents, fichiers)
    zip_size = zip_path.stat().st_size
    taille_mo = round(zip_size / (1024 * 1024), 2)

    if taille_mo > MAX_TOTAL_SIZE_MB:
        zip_path.unlink(missing_ok=True)
        return EmailSendResponse(
            success=False,
            message=f"ZIP de {taille_mo} Mo dépasse la limite Gmail de {MAX_TOTAL_SIZE_MB} Mo",
            destinataires=destinataires,
            fichiers_envoyes=[],
            taille_totale_mo=taille_mo,
        )

    # Générer le HTML avec le template brandé
    corps_html = generate_email_html(documents, nom_expediteur, zip_path=zip_path)

    # Construire le mail : mixed (related (alternative (text + html) + logos) + zip)
    msg = MIMEMultipart("mixed")
    from_display = f"{nom_expediteur} <{smtp_user}>" if nom_expediteur else smtp_user
    msg["From"] = from_display
    msg["To"] = ", ".join(destinataires)
    msg["Subject"] = objet

    # Related part (HTML + logos inline)
    related = MIMEMultipart("related")

    # Alternative part (text + HTML)
    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(corps, "plain", "utf-8"))
    alternative.attach(MIMEText(corps_html, "html", "utf-8"))
    related.attach(alternative)

    # Logo lockup pour header (CID: logo_main) — 400px, affiché 200px
    if LOGO_PATH.exists():
        with open(LOGO_PATH, "rb") as f:
            logo = MIMEImage(f.read(), _subtype="png")
        logo.add_header("Content-ID", "<logo_main>")
        logo.add_header("Content-Disposition", "inline", filename="logo.png")
        related.attach(logo)

    # Logo mark footer inline
    if LOGO_MARK_PATH.exists():
        with open(LOGO_MARK_PATH, "rb") as f:
            mark = MIMEImage(f.read(), _subtype="png")
        mark.add_header("Content-ID", "<logo_mark>")
        mark.add_header("Content-Disposition", "inline", filename="logo_mark.png")
        related.attach(mark)

    msg.attach(related)

    # ZIP en pièce jointe
    with open(zip_path, "rb") as f:
        zip_part = MIMEBase("application", "zip")
        zip_part.set_payload(f.read())
    encoders.encode_base64(zip_part)
    zip_part.add_header("Content-Disposition", f'attachment; filename="{zip_path.name}"')
    msg.attach(zip_part)

    # Nettoyer le ZIP temporaire
    zip_path.unlink(missing_ok=True)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, destinataires, msg.as_string())

        logger.info("Email envoyé à %s avec ZIP %.2f Mo (%d docs)", destinataires, taille_mo, len(documents))
        return EmailSendResponse(
            success=True,
            message=f"Email envoyé avec succès à {len(destinataires)} destinataire(s)",
            destinataires=destinataires,
            fichiers_envoyes=[doc.filename for doc in documents],
            taille_totale_mo=taille_mo,
        )
    except smtplib.SMTPAuthenticationError as e:
        return EmailSendResponse(
            success=False,
            message=f"Échec authentification SMTP — {e}",
            destinataires=destinataires,
            fichiers_envoyes=[],
            taille_totale_mo=taille_mo,
        )
    except Exception as e:
        logger.error("Erreur envoi email : %s", e)
        return EmailSendResponse(
            success=False,
            message=f"Erreur envoi : {str(e)}",
            destinataires=destinataires,
            fichiers_envoyes=[],
            taille_totale_mo=taille_mo,
        )


def generate_email_subject(documents: list[DocumentRef], nom: Optional[str] = None) -> str:
    """Génère un objet automatique."""
    types = set(d.type for d in documents)

    if len(documents) == 1:
        label = documents[0].filename.rsplit(".", 1)[0].replace("_", " ")
    elif types == {"export"}:
        periodes = []
        for d in documents:
            parts = d.filename.replace("Export_Comptable_", "").replace("Exports_Comptable_", "").replace(".zip", "").split("_")
            if len(parts) >= 2:
                periodes.append(parts[1])
        if periodes:
            label = f"Exports comptables — {' & '.join(periodes)}"
        else:
            label = f"Exports comptables ({len(documents)})"
    else:
        label = f"Documents comptables ({len(documents)} fichiers)"

    if nom:
        label += f" — {nom}"
    return label


def _clean_filename_for_display(filename: str) -> str:
    """Nettoie un nom de fichier pour affichage lisible."""
    name = filename.rsplit(".", 1)[0]
    name = name.replace("_", " ").replace("-", " ")
    # Supprimer les timestamps type 20260408 123456
    name = re.sub(r"\d{8}\s*\d{6}", "", name).strip()
    # Supprimer les hash courts
    name = re.sub(r"\b[a-f0-9]{8}\b", "", name).strip()
    # Nettoyer les espaces multiples
    name = re.sub(r"\s{2,}", " ", name).strip()
    return name or filename


def _resolve_single_period(documents: list[DocumentRef]) -> Optional[tuple[int, int]]:
    """Si tous les docs ont une même période (mois précis), retourne (year, month).

    Multi-périodes ou aucune période détectable → None.
    """
    periods_set: set[tuple[int, int]] = set()
    has_anonymous = False
    for d in documents:
        m = re.search(r"(\d{4})[-_](\d{2})", d.filename)
        if m:
            year = int(m.group(1))
            month = int(m.group(2))
            if 1 <= month <= 12:
                periods_set.add((year, month))
                continue
        # Essayer de parser le nom de mois directement
        matched = False
        for i, mois in enumerate(MOIS_FR):
            if mois.lower() in d.filename.lower():
                ym = re.search(r"(\d{4})", d.filename)
                if ym:
                    periods_set.add((int(ym.group(1)), i + 1))
                    matched = True
                    break
        if not matched:
            has_anonymous = True
    if len(periods_set) == 1 and not has_anonymous:
        return next(iter(periods_set))
    return None


def _check_envoi_notes_block(documents: list[DocumentRef]) -> tuple[Optional[str], Optional[str]]:
    """Retourne (period_label, notes) si une seule période détectée et notes non vides.

    Sinon (None, None). Évite l'injection en multi-périodes (l'utilisateur peut
    le faire à la main si pertinent).
    """
    single = _resolve_single_period(documents)
    if not single:
        return None, None
    try:
        from backend.services import check_envoi_service
        year, month = single
        notes = check_envoi_service.get_notes_for_email(year, month)
    except Exception:
        return None, None
    if not notes or not notes.strip():
        return None, None
    period_label = f"{MOIS_FR[month - 1].capitalize()} {year}"
    return period_label, notes


def generate_email_body_plain(documents: list[DocumentRef], nom: Optional[str] = None) -> str:
    """Génère le corps automatique plain text (fallback pour clients sans HTML)."""
    by_type: dict[str, list[DocumentRef]] = {}
    for d in documents:
        by_type.setdefault(d.type, []).append(d)

    type_headers = {
        "export": "Exports comptables",
        "rapport": "Rapports",
        "releve": "Relevés bancaires",
        "justificatif": "Justificatifs",
        "ged": "Documents",
    }

    lines = ["Bonjour,", ""]
    lines.append(f"Veuillez trouver ci-joint{'s' if len(documents) > 1 else ''} {len(documents)} document{'s' if len(documents) > 1 else ''} :")
    lines.append("")

    for t, docs in by_type.items():
        header = type_headers.get(t, "Fichiers")
        lines.append(f"{header} ({len(docs)}) :")
        for d in docs:
            display = _clean_filename_for_display(d.filename)
            lines.append(f"  - {display}")
        lines.append("")

    # Injection notes Check d'envoi (mono-période uniquement)
    period_label, notes = _check_envoi_notes_block(documents)
    if period_label and notes:
        lines.append(f"Notes pour {period_label}")
        lines.append(notes)
        lines.append("")

    signature = nom or "Dr"
    lines.extend(["Cordialement,", signature])
    return "\n".join(lines)


# Alias rétrocompatibilité
generate_email_body = generate_email_body_plain


# ─── Template HTML ───


def _load_email_template() -> str:
    """Charge le template HTML email."""
    template_path = TEMPLATE_DIR / "email_template.html"
    return template_path.read_text(encoding="utf-8")


def _extract_periods_from_docs(documents: list[DocumentRef]) -> list[str]:
    """Extrait les périodes (Mois Année) depuis les noms de fichiers exports."""
    periods = []
    for d in documents:
        # Pattern: Export_Comptable_2025-03_Mars.zip ou Export_Comptable_2025_Mars.zip
        m = re.search(r"(\d{4})[-_](\d{2})", d.filename)
        if m:
            year = int(m.group(1))
            month = int(m.group(2))
            if 1 <= month <= 12:
                periods.append(f"{MOIS_FR[month - 1]} {year}")
        else:
            # Essayer de parser le nom de mois directement
            for i, mois in enumerate(MOIS_FR):
                if mois.lower() in d.filename.lower():
                    # Trouver l'année
                    ym = re.search(r"(\d{4})", d.filename)
                    if ym:
                        periods.append(f"{MOIS_FR[i]} {ym.group(1)}")
                    break
    # Dédupliquer en gardant l'ordre
    seen: set[str] = set()
    unique: list[str] = []
    for p in periods:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def _build_zip_tree(zip_path: Path) -> tuple[str, str]:
    """Lit le contenu d'un ZIP et génère l'arborescence HTML.

    Returns: (zip_filename, arborescence_html)
    """
    if not zip_path or not zip_path.exists():
        return ("", "")

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = sorted(zf.namelist())

    # Séparer fichiers racine et sous-dossiers
    root_files: list[str] = []
    folders: dict[str, list[str]] = {}
    for name in names:
        if name.endswith("/"):
            continue  # skip directory entries
        parts = name.split("/")
        if len(parts) == 1:
            root_files.append(parts[0])
        else:
            folder = parts[0]
            fname = "/".join(parts[1:])
            folders.setdefault(folder, []).append(fname)

    all_entries: list[str] = []
    all_entries.extend(root_files)
    folder_names = sorted(folders.keys())

    lines: list[str] = []
    total_items = len(root_files) + len(folder_names)
    idx = 0

    # Fichiers racine
    for f in root_files:
        idx += 1
        prefix = "\u2514\u2500" if idx == total_items else "\u251c\u2500"
        lines.append(f'<p style="margin: 0; white-space: nowrap;">{prefix} {f}</p>')

    # Sous-dossiers
    for folder in folder_names:
        idx += 1
        is_last_folder = idx == total_items
        prefix = "\u2514\u2500" if is_last_folder else "\u251c\u2500"
        lines.append(f'<p style="margin: 0; white-space: nowrap; font-weight: 500;">{prefix} {folder}/</p>')

        sub_files = folders[folder]
        indent = "&nbsp;&nbsp;&nbsp;&nbsp;"
        if len(sub_files) <= 3:
            for j, sf in enumerate(sub_files):
                sub_prefix = "\u2514\u2500" if j == len(sub_files) - 1 else "\u251c\u2500"
                lines.append(f'<p style="margin: 0; white-space: nowrap;">{indent}{sub_prefix} {sf}</p>')
        else:
            for sf in sub_files[:3]:
                lines.append(f'<p style="margin: 0; white-space: nowrap;">{indent}\u251c\u2500 {sf}</p>')
            lines.append(f'<p style="margin: 0; white-space: nowrap; color: #999;">{indent}\u2514\u2500 \u2026 ({len(sub_files)} fichiers au total)</p>')

    return (zip_path.name, "\n".join(lines))


def _build_doc_tree(documents: list[DocumentRef]) -> tuple[str, str]:
    """Construit une arborescence simulée quand le ZIP n'existe pas (preview)."""
    by_folder: dict[str, list[str]] = {}
    for doc in documents:
        folder = TYPE_FOLDER_MAP.get(doc.type, "autres")
        by_folder.setdefault(folder, []).append(doc.filename)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"Documents_Comptables_{timestamp}.zip"

    lines: list[str] = []
    folder_names = sorted(by_folder.keys())
    for i, folder in enumerate(folder_names):
        is_last = i == len(folder_names) - 1
        prefix = "\u2514\u2500" if is_last else "\u251c\u2500"
        files = by_folder[folder]
        lines.append(f'<p style="margin: 0; white-space: nowrap; font-weight: 500;">{prefix} {folder}/</p>')

        indent = "&nbsp;&nbsp;&nbsp;&nbsp;"
        if len(files) <= 3:
            for j, f in enumerate(files):
                sub_prefix = "\u2514\u2500" if j == len(files) - 1 else "\u251c\u2500"
                lines.append(f'<p style="margin: 0; white-space: nowrap;">{indent}{sub_prefix} {f}</p>')
        else:
            for f in files[:3]:
                lines.append(f'<p style="margin: 0; white-space: nowrap;">{indent}\u251c\u2500 {f}</p>')
            lines.append(f'<p style="margin: 0; white-space: nowrap; color: #999;">{indent}\u2514\u2500 \u2026 ({len(files)} fichiers au total)</p>')

    return (zip_name, "\n".join(lines))


def _logo_src(path: Path, cid: str, for_preview: bool) -> str:
    """Retourne CID pour l'envoi réel, data-URI base64 pour le preview."""
    if not for_preview:
        return f"cid:{cid}"
    import base64
    if path.exists():
        b64 = base64.b64encode(path.read_bytes()).decode()
        return f"data:image/png;base64,{b64}"
    return f"cid:{cid}"


def generate_email_html(
    documents: list[DocumentRef],
    nom: Optional[str] = None,
    zip_path: Optional[Path] = None,
    for_preview: bool = False,
) -> str:
    """Génère le HTML de l'email avec template brandé et arborescence ZIP."""
    types = set(d.type for d in documents)
    periods = _extract_periods_from_docs(documents)
    period_str = " & ".join(periods) if periods else ""

    # Titre bandeau
    if types == {"export"}:
        if len(documents) == 1:
            titre_bandeau = f"Export comptable \u2014 {period_str}" if period_str else "Export comptable"
        else:
            titre_bandeau = f"Exports comptables \u2014 {period_str}" if period_str else "Exports comptables"
    else:
        titre_bandeau = f"Documents comptables \u2014 {period_str}" if period_str else "Documents comptables"

    # Introduction
    nb = len(documents)
    plural = "s" if nb > 1 else ""
    if types == {"export"}:
        type_label = "l'export comptable" if nb == 1 else "les exports comptables"
        intro_period = f" de {period_str}" if period_str else ""
        introduction = f"Veuillez trouver ci-joint{plural} {type_label}{intro_period} sous forme d'archive ZIP contenant :"
    else:
        introduction = f"Veuillez trouver ci-joint{plural} {nb} document{plural} comptable{plural} sous forme d'archive ZIP contenant :"

    # Arborescence
    if zip_path and zip_path.exists():
        zip_filename, arborescence_lines = _build_zip_tree(zip_path)
    else:
        zip_filename, arborescence_lines = _build_doc_tree(documents)

    arborescence_block = ""
    if arborescence_lines:
        arborescence_block = f"""<tr><td style="padding: 0 28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f8f8; border-radius: 6px; border: 1px solid #e8e8e8;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0 0 6px; font-size: 13px; font-weight: 500; color: #333333; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">{zip_filename}</p>
<div style="padding-left: 12px; font-size: 12px; color: #666666; font-family: 'SF Mono', Monaco, 'Courier New', monospace; line-height: 1.8;">
{arborescence_lines}
</div>
</td></tr>
</table>
</td></tr>"""

    signature = nom or "Dr"
    current_year = datetime.now().year

    logo_main_src = _logo_src(LOGO_PATH, "logo_main", for_preview)
    logo_mark_src = _logo_src(LOGO_MARK_PATH, "logo_mark", for_preview)

    # Notes Check d'envoi (mono-période uniquement)
    notes_section = ""
    period_label, notes = _check_envoi_notes_block(documents)
    if period_label and notes:
        notes_html = notes.replace("\n", "<br>")
        notes_section = (
            f'<tr><td style="padding: 0 28px 16px;">'
            f'<p style="margin: 0 0 8px; font-size: 13px; font-weight: 500; color: #534AB7;">'
            f'Notes pour {period_label}</p>'
            f'<div style="font-size: 13px; color: #333333; line-height: 1.6; '
            f'background-color: #f8f8f8; padding: 12px 16px; border-radius: 6px; '
            f'border-left: 3px solid #534AB7;">{notes_html}</div>'
            f'</td></tr>'
        )

    template = _load_email_template()
    return template.format(
        titre_bandeau=titre_bandeau,
        introduction=introduction,
        arborescence_block=arborescence_block,
        notes_section=notes_section,
        signature=signature,
        current_year=current_year,
        logo_main_src=logo_main_src,
        logo_mark_src=logo_mark_src,
    )
