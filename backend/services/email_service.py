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

    # Générer le HTML
    corps_html = generate_email_html(corps)

    # Construire le mail : mixed (related (alternative (text + html) + logo) + zip)
    msg = MIMEMultipart("mixed")
    from_display = f"{nom_expediteur} <{smtp_user}>" if nom_expediteur else smtp_user
    msg["From"] = from_display
    msg["To"] = ", ".join(destinataires)
    msg["Subject"] = objet

    # Related part (HTML + logo inline)
    related = MIMEMultipart("related")

    # Alternative part (text + HTML)
    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(corps, "plain", "utf-8"))
    alternative.attach(MIMEText(corps_html, "html", "utf-8"))
    related.attach(alternative)

    # Logo header inline
    if LOGO_PATH.exists():
        with open(LOGO_PATH, "rb") as f:
            logo = MIMEImage(f.read(), _subtype="png")
        logo.add_header("Content-ID", "<logo_neuronx>")
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


def generate_email_body(documents: list[DocumentRef], nom: Optional[str] = None) -> str:
    """Génère le corps automatique avec liste détaillée des fichiers."""
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

    signature = nom or "Dr"
    lines.extend(["Cordialement,", signature])
    return "\n".join(lines)


LOGO_MARK_PATH = ASSETS_DIR / "logo_mark_64.png"


def generate_email_html(corps_text: str) -> str:
    """Convertit le corps texte en HTML avec logo en-tête et footer copyright."""
    current_year = datetime.now().year

    # Convertir les lignes texte en HTML
    lines_html = ""
    for line in corps_text.split("\n"):
        stripped = line.strip()
        if not stripped:
            lines_html += "<br>"
        elif stripped.startswith("- "):
            lines_html += f'<p style="margin:2px 0 2px 24px;color:#cccccc;font-size:13px;">&#8226; {stripped[2:]}</p>'
        elif stripped.endswith(") :") or stripped.endswith("):"):
            # Section header (e.g. "Exports comptables (2) :")
            lines_html += f'<p style="margin:12px 0 4px 0;color:#a0a0ff;font-size:13px;font-weight:600;">{stripped}</p>'
        else:
            lines_html += f'<p style="margin:4px 0;color:#e0e0e0;font-size:14px;">{line}</p>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1a2e;padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#16213e;border-radius:12px;overflow:hidden;">
          <!-- Logo header -->
          <tr>
            <td align="center" style="padding:30px 40px 20px 40px;border-bottom:1px solid #2a2a4a;">
              <img src="cid:logo_neuronx" alt="NeuronXcompta" width="200" style="display:block;">
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:30px 40px;line-height:1.6;">
              {lines_html}
            </td>
          </tr>
          <!-- Footer copyright -->
          <tr>
            <td align="center" style="padding:20px 40px;border-top:1px solid #2a2a4a;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:8px;vertical-align:middle;">
                    <img src="cid:logo_mark" alt="" width="20" height="20" style="display:block;">
                  </td>
                  <td style="vertical-align:middle;font-size:11px;color:#888;">
                    &copy; {current_year} NeuronXcompta
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
