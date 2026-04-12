from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import BASE_DIR, BAREMES_DIR, IMPORTS_OPERATIONS_DIR, ensure_directories
from backend.models.charges_forfaitaires import (
    ArticleDetail,
    BaremeBlanchissage,
    BlanchissageRequest,
    ForfaitResult,
    GenerateODRequest,
    GenerateODResponse,
    ModeBlanchissage,
    TypeForfait,
)

logger = logging.getLogger(__name__)

DATA_DIR = BASE_DIR / "data"
JUSTIFICATIFS_EN_ATTENTE_DIR = DATA_DIR / "justificatifs" / "en_attente"
REPORTS_DIR = DATA_DIR / "reports"
CONFIG_FILE = DATA_DIR / "charges_forfaitaires_config.json"


class ChargesForfaitairesService:

    # ── Config persistée par année ──

    def _load_all_config(self) -> dict:
        if CONFIG_FILE.exists():
            try:
                return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return {}

    def _save_all_config(self, data: dict) -> None:
        CONFIG_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def get_config(self, year: int) -> dict:
        all_cfg = self._load_all_config()
        return all_cfg.get(str(year), {})

    def update_config(self, year: int, updates: dict) -> dict:
        all_cfg = self._load_all_config()
        year_cfg = all_cfg.get(str(year), {})
        year_cfg.update(updates)
        all_cfg[str(year)] = year_cfg
        self._save_all_config(all_cfg)
        return year_cfg

    # ── Chargement barème ──

    def _load_bareme_blanchissage(self, year: int) -> BaremeBlanchissage:
        """
        Charge baremes/blanchissage_{year}.json.
        Fallback : année la plus récente disponible.
        """
        ensure_directories()
        target = BAREMES_DIR / f"blanchissage_{year}.json"
        if target.exists():
            data = json.loads(target.read_text(encoding="utf-8"))
            return BaremeBlanchissage(**data)

        # Fallback : trouver le plus récent
        candidates = sorted(BAREMES_DIR.glob("blanchissage_*.json"), reverse=True)
        if not candidates:
            raise FileNotFoundError("Aucun barème blanchissage trouvé")
        data = json.loads(candidates[0].read_text(encoding="utf-8"))
        return BaremeBlanchissage(**data)

    # ── Calcul ──

    def calculer_blanchissage(self, request: BlanchissageRequest) -> ForfaitResult:
        """
        Calcule le montant déductible.
        - mode domicile : montant = tarif × (1 - decote) × qté × jours
        - mode pressing : montant = tarif × qté × jours
        """
        bareme = self._load_bareme_blanchissage(request.year)
        decote = bareme.decote_domicile if request.mode == ModeBlanchissage.DOMICILE else 0.0
        coefficient = 1.0 - decote

        details: list[ArticleDetail] = []
        total = 0.0
        cout_jour = 0.0

        for art in bareme.articles:
            montant_unitaire = round(art.tarif_pressing * coefficient, 2)
            sous_total = round(montant_unitaire * art.quantite_jour * request.jours_travailles, 2)
            total += sous_total
            cout_jour += montant_unitaire * art.quantite_jour

            details.append(ArticleDetail(
                type=art.type,
                tarif_pressing=art.tarif_pressing,
                montant_unitaire=montant_unitaire,
                quantite_jour=art.quantite_jour,
                jours=request.jours_travailles,
                sous_total=sous_total,
            ))

        total = round(total, 2)
        cout_jour = round(cout_jour, 2)

        return ForfaitResult(
            type_forfait=TypeForfait.BLANCHISSAGE,
            year=request.year,
            montant_total=total,
            montant_deductible=total,
            detail=details,
            reference_legale=bareme.reference_legale,
            mode=request.mode.value,
            decote=decote,
            jours_travailles=request.jours_travailles,
            cout_jour=cout_jour,
            honoraires_liasse=request.honoraires_liasse,
        )

    # ── Génération OD ──

    def generer_od(self, request: GenerateODRequest) -> GenerateODResponse:
        """
        1. Calculer le montant
        2. Trouver/créer le fichier opérations de décembre
        3. Ajouter l'opération OD
        4. Générer le PDF reconstitué
        5. Enregistrer dans la GED
        """
        # 1. Calcul
        calc_request = BlanchissageRequest(
            year=request.year,
            jours_travailles=request.jours_travailles,
            mode=request.mode,
        )
        result = self.calculer_blanchissage(calc_request)

        # 2. Trouver le fichier opérations de décembre
        date_ecriture = request.date_ecriture or f"{request.year}-12-31"
        target_file = self._find_or_create_december_file(request.year)

        # 3. Charger les opérations, vérifier qu'il n'y a pas de doublon
        filepath = IMPORTS_OPERATIONS_DIR / target_file
        operations = json.loads(filepath.read_text(encoding="utf-8"))

        # Vérifier doublon : même type + même année dans commentaire
        doublon_marker = f"Charge forfaitaire blanchissage {request.year}"
        for op in operations:
            if op.get("Commentaire", "").startswith(doublon_marker):
                raise ValueError(
                    f"Un forfait blanchissage existe déjà pour {request.year} dans {target_file}"
                )

        # Créer l'opération OD
        od = {
            "Date": date_ecriture,
            "Libellé": f"Frais de blanchissage professionnel {request.year}",
            "Débit": result.montant_deductible,
            "Crédit": 0,
            "Catégorie": "Blanchissage professionnel",
            "Sous-catégorie": "Forfait annuel",
            "Justificatif": True,
            "Lien justificatif": "",
            "Important": False,
            "A_revoir": False,
            "Commentaire": f"{doublon_marker} — {result.reference_legale}",
            "alertes": [],
            "compte_attente": False,
            "alertes_resolues": [],
            "lettre": True,
            "type_operation": "OD",
        }
        operations.append(od)
        od_index = len(operations) - 1

        # Sauvegarder
        filepath.write_text(
            json.dumps(operations, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 4. Générer le PDF
        pdf_filename = self._generer_pdf_blanchissage(result)

        # 5. Lier le rapport à l'OD
        operations[od_index]["Lien justificatif"] = f"reports/{pdf_filename}"
        filepath.write_text(
            json.dumps(operations, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 6. Enregistrer dans la GED
        ged_doc_id = self._register_ged(pdf_filename, result, target_file, od_index)

        return GenerateODResponse(
            od_filename=target_file,
            od_index=od_index,
            pdf_filename=pdf_filename,
            ged_doc_id=ged_doc_id,
            montant=result.montant_deductible,
        )

    def _find_or_create_december_file(self, year: int) -> str:
        """
        Cherche le fichier opérations contenant des dates de décembre pour l'année.
        Les fichiers sont nommés avec des timestamps, pas YYYYMM.
        On scanne le contenu pour trouver le mois dominant.
        """
        ensure_directories()
        best_file: Optional[str] = None

        for f in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
            try:
                ops = json.loads(f.read_text(encoding="utf-8"))
                if not ops or not isinstance(ops, list):
                    continue
                # Extraire les dates et trouver le mois dominant
                months: dict[int, int] = {}
                for op in ops:
                    date_str = op.get("Date", "")
                    if date_str.startswith(f"{year}-"):
                        try:
                            month = int(date_str.split("-")[1])
                            months[month] = months.get(month, 0) + 1
                        except (ValueError, IndexError):
                            continue
                if months:
                    dominant_month = max(months, key=lambda m: months[m])
                    if dominant_month == 12:
                        return f.name
                    # Garder le dernier fichier de l'année comme fallback
                    best_file = f.name
            except (json.JSONDecodeError, KeyError):
                continue

        # Si pas de fichier décembre, utiliser le dernier fichier de l'année
        if best_file:
            return best_file

        # Créer un nouveau fichier
        import hashlib
        import time
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        h = hashlib.sha256(str(time.time()).encode()).hexdigest()[:8]
        new_name = f"operations_{ts}_{h}.json"
        new_path = IMPORTS_OPERATIONS_DIR / new_name
        new_path.write_text(
            json.dumps([{
                "Date": f"{year}-12-31",
                "Libellé": "Fichier créé pour écritures de décembre",
                "Débit": 0,
                "Crédit": 0,
                "Catégorie": "",
                "Sous-catégorie": "",
                "Justificatif": False,
                "Lien justificatif": "",
                "Important": False,
                "A_revoir": False,
                "Commentaire": "",
                "alertes": [],
                "compte_attente": False,
                "alertes_resolues": [],
                "lettre": False,
            }], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return new_name

    def _generer_pdf_blanchissage(self, result: ForfaitResult) -> str:
        """
        PDF ReportLab A4 portrait avec logo, tableau détaillé, notes légales.
        """
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            Image,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
            Paragraph,
        )

        # Nom du fichier
        montant_str = f"{result.montant_deductible:.2f}".replace(".", ",")
        date_str = f"{result.year}1231"
        filename = f"blanchissage_{date_str}_{montant_str}.pdf"

        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = REPORTS_DIR / filename

        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=A4,
            topMargin=20 * mm,
            bottomMargin=20 * mm,
            leftMargin=15 * mm,
            rightMargin=15 * mm,
        )

        styles = getSampleStyleSheet()
        elements = []

        # Logo
        logo_path = BASE_DIR / "backend" / "assets" / "logo_lockup_light_400.png"
        if logo_path.exists():
            elements.append(Image(str(logo_path), width=50 * mm, height=15 * mm))
            elements.append(Spacer(1, 10 * mm))

        # Titre
        title_style = ParagraphStyle(
            "CustomTitle", parent=styles["Heading1"], fontSize=16, spaceAfter=4 * mm
        )
        elements.append(Paragraph("Frais de blanchissage professionnel", title_style))

        mode_label = "Lavage à domicile" if result.mode == "domicile" else "Pressing professionnel"
        subtitle_style = ParagraphStyle(
            "Subtitle", parent=styles["Normal"], fontSize=11, textColor=colors.grey
        )
        elements.append(Paragraph(f"Exercice {result.year} — {mode_label}", subtitle_style))
        elements.append(Spacer(1, 4 * mm))

        # Helpers
        def fmt_eur(val: float) -> str:
            return f"{val:,.2f} \u20ac".replace(",", "\u00a0").replace(".", ",").replace("\u00a0", "\u00a0")

        # Nombre de jours travaillés
        jours_label = f"{result.jours_travailles:g}"  # supprime le .0 si entier
        info_style = ParagraphStyle(
            "Info", parent=styles["Normal"], fontSize=10, spaceAfter=2 * mm
        )
        elements.append(Paragraph(
            f"Nombre de jours travaillés : <b>{jours_label}</b> — "
            f"Coût journalier : <b>{fmt_eur(result.cout_jour)}</b>",
            info_style,
        ))
        if result.honoraires_liasse:
            elements.append(Paragraph(
                f"Honoraires liasse fiscale SCP : <b>{fmt_eur(result.honoraires_liasse)}</b>",
                info_style,
            ))
        elements.append(Spacer(1, 4 * mm))

        # Tableau

        header = ["Article", "Tarif réf.", "Décote", "Montant", "Qté/j", "Jours", "Sous-total"]
        data = [header]
        decote_label = f"{int(result.decote * 100)}%" if result.decote > 0 else "—"

        for art in result.detail:
            data.append([
                art.type,
                fmt_eur(art.tarif_pressing),
                decote_label,
                fmt_eur(art.montant_unitaire),
                str(art.quantite_jour),
                str(art.jours),
                fmt_eur(art.sous_total),
            ])

        # Ligne total
        data.append(["Total annuel déductible", "", "", "", "", "", fmt_eur(result.montant_deductible)])

        col_widths = [45 * mm, 22 * mm, 18 * mm, 22 * mm, 15 * mm, 15 * mm, 28 * mm]
        table = Table(data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("BOLD", (0, 0), (-1, 0), True),
            ("BOLD", (0, -1), (-1, -1), True),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey),
            ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(table)
        elements.append(Spacer(1, 10 * mm))

        # Pied de page
        note_style = ParagraphStyle(
            "Note", parent=styles["Normal"], fontSize=8, textColor=colors.grey
        )
        elements.append(Paragraph(
            f"Jours travaillés : {result.jours_travailles} jours (saisie manuelle)", note_style
        ))
        if result.mode == "domicile":
            elements.append(Paragraph(
                f"Réf. {result.reference_legale} — Décote {int(result.decote * 100)}% pour lavage à domicile",
                note_style,
            ))
        now_str = datetime.now().strftime("%d/%m/%Y")
        elements.append(Paragraph(f"Document généré le {now_str} — NeuronXcompta", note_style))

        doc.build(elements)
        logger.info(f"PDF blanchissage généré: {filename}")
        return filename

    def _register_ged(self, pdf_filename: str, result: ForfaitResult, op_file: str, op_index: int) -> str:
        """Enregistre le PDF dans la GED metadata."""
        from backend.services.ged_service import load_metadata, save_metadata

        src_path = REPORTS_DIR / pdf_filename
        # doc_id relatif à BASE_DIR
        try:
            doc_id = str(src_path.relative_to(BASE_DIR))
        except ValueError:
            doc_id = str(src_path)

        metadata = load_metadata()
        docs = metadata.get("documents", {})

        now = datetime.now().isoformat()
        docs[doc_id] = {
            "doc_id": doc_id,
            "type": "rapport",
            "filename": pdf_filename,
            "year": result.year,
            "month": 12,
            "poste_comptable": None,
            "categorie": "Blanchissage professionnel",
            "sous_categorie": "Forfait annuel",
            "montant_brut": None,
            "deductible_pct_override": None,
            "tags": [],
            "notes": "",
            "added_at": now,
            "original_name": pdf_filename,
            "ocr_file": None,
            "fournisseur": "Blanchissage",
            "date_document": f"{result.year}-12-31",
            "date_operation": f"{result.year}-12-31",
            "period": {"year": result.year, "month": 12},
            "montant": result.montant_deductible,
            "ventilation_index": None,
            "is_reconstitue": False,
            "operation_ref": f"{op_file}:{op_index}",
            "source_module": "charges-forfaitaires",
            "rapport_meta": {
                "template_id": None,
                "title": f"Frais de blanchissage professionnel {result.year}",
                "description": f"Charge forfaitaire blanchissage — {result.jours_travailles:g} jours — {result.montant_deductible:.2f} €",
                "filters": {"year": result.year, "month": 12},
                "format": "pdf",
                "favorite": False,
                "generated_at": now,
                "can_regenerate": False,
                "can_compare": False,
            },
        }

        metadata["documents"] = docs
        save_metadata(metadata)
        logger.info(f"GED enregistré: {doc_id}")
        return doc_id

    # ── Lecture forfaits existants ──

    def get_forfaits_generes(self, year: int) -> list[dict]:
        """
        Scanner les fichiers d'opérations de l'année pour trouver les OD forfaitaires.
        Retourne aussi pdf_filename et ged_doc_id pour le preview et la navigation.
        """
        ensure_directories()
        results: list[dict] = []
        marker = f"Charge forfaitaire blanchissage {year}"

        for f in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
            try:
                ops = json.loads(f.read_text(encoding="utf-8"))
                for i, op in enumerate(ops):
                    comment = op.get("Commentaire", "")
                    if comment.startswith(marker) and op.get("type_operation") == "OD":
                        # Extraire le nom du PDF depuis le lien justificatif
                        lien = op.get("Lien justificatif", "")
                        pdf_filename = lien.split("/")[-1] if lien else ""

                        # Trouver le ged_doc_id correspondant
                        ged_doc_id = ""
                        if pdf_filename:
                            from backend.services.ged_service import load_metadata
                            metadata = load_metadata()
                            docs = metadata.get("documents", {})
                            for doc_id, doc in docs.items():
                                if doc.get("filename") == pdf_filename:
                                    ged_doc_id = doc_id
                                    break

                        results.append({
                            "type_forfait": "blanchissage",
                            "montant": op.get("Débit", 0),
                            "date_ecriture": op.get("Date", ""),
                            "od_filename": f.name,
                            "od_index": i,
                            "pdf_filename": pdf_filename,
                            "ged_doc_id": ged_doc_id,
                        })
            except (json.JSONDecodeError, KeyError):
                continue

        return results

    # ── Suppression ──

    def supprimer_forfait(self, type_forfait: str, year: int) -> bool:
        """
        1. Trouver l'OD via get_forfaits_generes
        2. Supprimer l'opération du fichier JSON
        3. Supprimer le PDF
        4. Supprimer l'entrée GED
        """
        generes = self.get_forfaits_generes(year)
        if not generes:
            return False

        from backend.services.ged_service import load_metadata, save_metadata

        for g in generes:
            # Supprimer l'opération
            filepath = IMPORTS_OPERATIONS_DIR / g["od_filename"]
            ops = json.loads(filepath.read_text(encoding="utf-8"))
            if g["od_index"] < len(ops):
                ops.pop(g["od_index"])
                filepath.write_text(
                    json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8"
                )

            # Supprimer le PDF (reports + justificatifs en_attente/traites pour legacy)
            traites_dir = DATA_DIR / "justificatifs" / "traites"
            for directory in [REPORTS_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR, traites_dir]:
                for pattern in [f"blanchissage_{year}*", f"reconstitue_blanchissage_{year}*"]:
                    for pdf in directory.glob(pattern):
                        pdf.unlink(missing_ok=True)
                        logger.info(f"PDF supprimé: {pdf.name}")

            # Supprimer de la GED
            metadata = load_metadata()
            docs = metadata.get("documents", {})
            to_remove = [
                doc_id for doc_id, doc in docs.items()
                if doc.get("filename", "").startswith(f"blanchissage_{year}")
                or doc.get("filename", "").startswith(f"reconstitue_blanchissage_{year}")
            ]
            for doc_id in to_remove:
                docs.pop(doc_id, None)
                logger.info(f"GED supprimé: {doc_id}")
            metadata["documents"] = docs
            save_metadata(metadata)

        return True
