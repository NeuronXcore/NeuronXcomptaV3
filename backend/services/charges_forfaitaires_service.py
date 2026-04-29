from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import BASE_DIR, BAREMES_DIR, IMPORTS_OPERATIONS_DIR, ensure_directories
from backend.models.charges_forfaitaires import (
    ApplyVehiculeRequest,
    ApplyVehiculeResponse,
    ArticleDetail,
    BaremeBlanchissage,
    BlanchissageRequest,
    ForfaitResult,
    GenerateODRequest,
    GenerateODResponse,
    ModeBlanchissage,
    RepasRequest,
    RepasResult,
    TypeForfait,
    VehiculeRequest,
    VehiculeResult,
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
        if request.type_forfait == TypeForfait.REPAS:
            return self.generer_repas(request)

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
            "source": "blanchissage",
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

                        # Fallback : chercher le PDF par pattern dans data/reports/
                        if not pdf_filename:
                            candidates = sorted(REPORTS_DIR.glob(f"blanchissage_{year}*"), reverse=True)
                            if candidates:
                                pdf_filename = candidates[0].name

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
                            # Fallback ged_doc_id par path
                            if not ged_doc_id:
                                candidate_id = f"data/reports/{pdf_filename}"
                                if candidate_id in docs:
                                    ged_doc_id = candidate_id

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
        if type_forfait == "repas":
            return self.supprimer_repas(year)

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

    # ══════════════════════════════════════════════════════════
    # ── Repas professionnels (forfait déductible) ──
    # ══════════════════════════════════════════════════════════

    def _load_bareme_repas(self, year: int) -> dict:
        """Charge baremes/repas_{year}.json. Fallback année la plus récente."""
        ensure_directories()
        target = BAREMES_DIR / f"repas_{year}.json"
        if target.exists():
            return json.loads(target.read_text(encoding="utf-8"))
        candidates = sorted(BAREMES_DIR.glob("repas_*.json"), reverse=True)
        if not candidates:
            raise FileNotFoundError("Aucun barème repas trouvé")
        return json.loads(candidates[0].read_text(encoding="utf-8"))

    def calculer_repas(self, request: RepasRequest) -> RepasResult:
        """Calcule le forfait repas déductible."""
        bareme = self._load_bareme_repas(request.year)
        forfait_jour = round(bareme["plafond_repas_restaurant"] - bareme["seuil_repas_maison"], 2)
        montant_deductible = round(forfait_jour * request.jours_travailles, 2)

        return RepasResult(
            year=request.year,
            montant_deductible=montant_deductible,
            cout_jour=forfait_jour,
            seuil_repas_maison=bareme["seuil_repas_maison"],
            plafond_repas_restaurant=bareme["plafond_repas_restaurant"],
            jours_travailles=request.jours_travailles,
            reference_legale=bareme.get("reference_legale", "BOI-BNC-BASE-40-60"),
        )

    def generer_repas(self, request: GenerateODRequest) -> GenerateODResponse:
        """Génère OD repas + PDF + GED."""
        calc = self.calculer_repas(RepasRequest(
            year=request.year,
            jours_travailles=request.jours_travailles,
        ))

        date_ecriture = request.date_ecriture or f"{request.year}-12-31"
        target_file = self._find_or_create_december_file(request.year)
        filepath = IMPORTS_OPERATIONS_DIR / target_file
        operations = json.loads(filepath.read_text(encoding="utf-8"))

        # Déduplication
        doublon_marker = f"Charge forfaitaire repas {request.year}"
        for op in operations:
            if op.get("Commentaire", "").startswith(doublon_marker):
                raise ValueError(
                    f"Un forfait repas existe déjà pour {request.year} dans {target_file}"
                )

        od = {
            "Date": date_ecriture,
            "Libellé": f"Forfait repas professionnels {request.year} — {calc.reference_legale}",
            "Débit": calc.montant_deductible,
            "Crédit": 0,
            "Catégorie": "Repas pro",
            "Sous-catégorie": "Repas seul",
            "Justificatif": True,
            "Lien justificatif": "",
            "Important": False,
            "A_revoir": False,
            "Commentaire": f"{doublon_marker} — {calc.reference_legale}",
            "alertes": [],
            "compte_attente": False,
            "alertes_resolues": [],
            "lettre": True,
            "type_operation": "OD",
            "source": "repas",
        }
        operations.append(od)
        od_index = len(operations) - 1
        filepath.write_text(json.dumps(operations, ensure_ascii=False, indent=2), encoding="utf-8")

        # PDF
        pdf_filename = self._generer_pdf_repas(calc)

        # Lien justificatif
        operations[od_index]["Lien justificatif"] = f"reports/{pdf_filename}"
        filepath.write_text(json.dumps(operations, ensure_ascii=False, indent=2), encoding="utf-8")

        # GED
        ged_doc_id = self._register_ged_repas(pdf_filename, calc, target_file, od_index)

        return GenerateODResponse(
            od_filename=target_file,
            od_index=od_index,
            pdf_filename=pdf_filename,
            ged_doc_id=ged_doc_id,
            montant=calc.montant_deductible,
        )

    def _generer_pdf_repas(self, result: RepasResult) -> str:
        """PDF ReportLab A4 pour le forfait repas."""
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

        montant_str = f"{result.montant_deductible:.2f}".replace(".", ",")
        date_str = f"{result.year}1231"
        filename = f"repas_{date_str}_{montant_str}.pdf"

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
        elements.append(Paragraph(f"Charges forfaitaires — Repas professionnels {result.year}", title_style))

        subtitle_style = ParagraphStyle(
            "Subtitle", parent=styles["Normal"], fontSize=11, textColor=colors.grey
        )
        elements.append(Paragraph(f"Référence légale : {result.reference_legale}", subtitle_style))
        elements.append(Spacer(1, 6 * mm))

        def fmt_eur(val: float) -> str:
            return f"{val:,.2f} \u20ac".replace(",", "\u00a0").replace(".", ",").replace("\u00a0", "\u00a0")

        # Tableau
        data = [
            ["Paramètre", "Valeur", "Source"],
            ["Seuil repas pris au domicile", fmt_eur(result.seuil_repas_maison), "URSSAF"],
            ["Plafond repas au restaurant", fmt_eur(result.plafond_repas_restaurant), "URSSAF"],
            ["Forfait déductible / jour", fmt_eur(result.cout_jour), "Calculé"],
            [f"Nombre de jours travaillés", f"{result.jours_travailles:g}", "Saisie"],
            ["Total annuel déductible", fmt_eur(result.montant_deductible), "Calculé"],
        ]

        col_widths = [70 * mm, 40 * mm, 40 * mm]
        table = Table(data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("BOLD", (0, 0), (-1, 0), True),
            ("BOLD", (0, -1), (-1, -1), True),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("ALIGN", (2, 0), (2, -1), "CENTER"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey),
            ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e8f5e9")),
        ]))
        elements.append(table)
        elements.append(Spacer(1, 10 * mm))

        # Notes
        note_style = ParagraphStyle(
            "Note", parent=styles["Normal"], fontSize=8, textColor=colors.grey
        )
        elements.append(Paragraph("Aucun justificatif requis pour ce forfait", note_style))
        elements.append(Paragraph(
            f"Formule : (plafond restaurant − seuil domicile) × jours = "
            f"({result.plafond_repas_restaurant} − {result.seuil_repas_maison}) × {result.jours_travailles:g} = "
            f"{result.montant_deductible:.2f} €",
            note_style,
        ))
        now_str = datetime.now().strftime("%d/%m/%Y")
        elements.append(Paragraph(f"Document généré le {now_str} — NeuronXcompta", note_style))

        doc.build(elements)
        logger.info(f"PDF repas généré: {filename}")
        return filename

    def _register_ged_repas(self, pdf_filename: str, result: RepasResult, op_file: str, op_index: int) -> str:
        """Enregistre le PDF repas dans la GED metadata."""
        from backend.services.ged_service import load_metadata, save_metadata

        src_path = REPORTS_DIR / pdf_filename
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
            "categorie": "Repas pro",
            "sous_categorie": "Repas seul",
            "montant_brut": None,
            "deductible_pct_override": None,
            "tags": [],
            "notes": "",
            "added_at": now,
            "original_name": pdf_filename,
            "ocr_file": None,
            "fournisseur": "Repas",
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
                "title": f"Forfait repas {result.year}",
                "description": f"Charge forfaitaire repas — {result.jours_travailles:g} jours — {result.montant_deductible:.2f} €",
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
        logger.info(f"GED repas enregistré: {doc_id}")
        return doc_id

    def get_repas_generes(self, year: int) -> list[dict]:
        """Scanner les fichiers d'opérations pour trouver les OD repas."""
        ensure_directories()
        results: list[dict] = []
        marker = f"Charge forfaitaire repas {year}"

        for f in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
            try:
                ops = json.loads(f.read_text(encoding="utf-8"))
                for i, op in enumerate(ops):
                    comment = op.get("Commentaire", "")
                    if comment.startswith(marker) and op.get("type_operation") == "OD":
                        lien = op.get("Lien justificatif", "")
                        pdf_filename = lien.split("/")[-1] if lien else ""

                        if not pdf_filename:
                            candidates = sorted(REPORTS_DIR.glob(f"repas_{year}*"), reverse=True)
                            if candidates:
                                pdf_filename = candidates[0].name

                        ged_doc_id = ""
                        if pdf_filename:
                            from backend.services.ged_service import load_metadata
                            meta = load_metadata()
                            docs = meta.get("documents", {})
                            for doc_id, doc in docs.items():
                                if doc.get("filename") == pdf_filename:
                                    ged_doc_id = doc_id
                                    break
                            if not ged_doc_id:
                                candidate_id = f"data/reports/{pdf_filename}"
                                if candidate_id in docs:
                                    ged_doc_id = candidate_id

                        results.append({
                            "type_forfait": "repas",
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

    def supprimer_repas(self, year: int) -> bool:
        """Supprime OD repas + PDF + GED."""
        generes = self.get_repas_generes(year)
        if not generes:
            return False

        from backend.services.ged_service import load_metadata, save_metadata

        for g in generes:
            filepath = IMPORTS_OPERATIONS_DIR / g["od_filename"]
            ops = json.loads(filepath.read_text(encoding="utf-8"))
            if g["od_index"] < len(ops):
                ops.pop(g["od_index"])
                filepath.write_text(json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8")

            traites_dir = DATA_DIR / "justificatifs" / "traites"
            for directory in [REPORTS_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR, traites_dir]:
                for pattern in [f"repas_{year}*"]:
                    for pdf in directory.glob(pattern):
                        pdf.unlink(missing_ok=True)
                        logger.info(f"PDF supprimé: {pdf.name}")

            metadata = load_metadata()
            docs = metadata.get("documents", {})
            to_remove = [
                doc_id for doc_id, doc in docs.items()
                if doc.get("filename", "").startswith(f"repas_{year}")
            ]
            for doc_id in to_remove:
                docs.pop(doc_id, None)
                logger.info(f"GED supprimé: {doc_id}")
            metadata["documents"] = docs
            save_metadata(metadata)

        return True

    # ══════════════════════════════════════════════════════════
    # ── Véhicule : quote-part professionnelle ──
    # ══════════════════════════════════════════════════════════

    def _load_bareme_vehicule(self, year: int) -> dict:
        """
        Charge baremes/vehicule_{year}.json.
        Fallback : année la plus récente disponible.
        Si aucun fichier, retourne un dict par défaut.
        """
        ensure_directories()
        target = BAREMES_DIR / f"vehicule_{year}.json"
        if target.exists():
            return json.loads(target.read_text(encoding="utf-8"))

        candidates = sorted(BAREMES_DIR.glob("vehicule_*.json"), reverse=True)
        if candidates:
            return json.loads(candidates[0].read_text(encoding="utf-8"))

        return {
            "annee": year,
            "date_derniere_application": None,
            "ratio_pro_applique": None,
            "historique": [],
        }

    def _save_bareme_vehicule(self, year: int, data: dict) -> None:
        BAREMES_DIR.mkdir(parents=True, exist_ok=True)
        target = BAREMES_DIR / f"vehicule_{year}.json"
        target.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ── Véhicule : calcul ──

    def calculer_vehicule(self, request: VehiculeRequest) -> VehiculeResult:
        """Calcule le ratio pro sans rien persister."""
        km_trajet = round(request.jours_travailles * request.distance_domicile_clinique_km * 2, 1)
        km_pro = round(km_trajet + request.km_supplementaires, 1)
        ratio_pro = round(min((km_pro / request.km_totaux_compteur) * 100, 100), 1)
        ratio_perso = round(100 - ratio_pro, 1)

        ancien_ratio = self._get_current_vehicule_pct()
        delta = round(ratio_pro - ancien_ratio, 1) if ancien_ratio is not None else None

        return VehiculeResult(
            year=request.year,
            distance_domicile_clinique_km=request.distance_domicile_clinique_km,
            jours_travailles=request.jours_travailles,
            km_trajet_habituel=km_trajet,
            km_supplementaires=request.km_supplementaires,
            km_pro_total=km_pro,
            km_totaux_compteur=request.km_totaux_compteur,
            ratio_pro=ratio_pro,
            ratio_perso=ratio_perso,
            ancien_ratio=ancien_ratio,
            delta_ratio=delta,
        )

    # ── Véhicule : application ──

    def appliquer_vehicule(self, request: ApplyVehiculeRequest) -> ApplyVehiculeResponse:
        """
        1. Calculer le ratio
        2. Mettre à jour le deductible_pct du poste Véhicule dans ged_postes.json
        3. Sauvegarder la config dans charges_forfaitaires_config.json
        4. Générer le PDF rapport dans data/reports/
        5. Enregistrer dans la GED comme type "rapport"
        6. Mettre à jour l'historique dans le barème véhicule
        7. Créer / rafraîchir l'OD signalétique au 31/12 (Débit=0/Crédit=0,
           source=vehicule, lien justificatif vers le PDF rapport) — purement
           visuelle dans Édition/Justificatifs ; le ratio comptable reste
           appliqué via le poste GED `vehicule.deductible_pct`.
        """
        calc_request = VehiculeRequest(
            year=request.year,
            distance_domicile_clinique_km=request.distance_domicile_clinique_km,
            jours_travailles=request.jours_travailles,
            km_supplementaires=request.km_supplementaires,
            km_totaux_compteur=request.km_totaux_compteur,
        )
        result = self.calculer_vehicule(calc_request)

        # 2. Mettre à jour le poste GED
        ancien_ratio = self._get_current_vehicule_pct() or 0
        poste_updated = self._update_vehicule_poste_pct(result.ratio_pro)

        # 3. Sauvegarder dans la config partagée
        config = self._load_all_config()
        year_key = str(request.year)
        if year_key not in config:
            config[year_key] = {}
        config[year_key]["vehicule_distance_km"] = request.distance_domicile_clinique_km
        config[year_key]["vehicule_km_supplementaires"] = request.km_supplementaires
        config[year_key]["vehicule_km_totaux_compteur"] = request.km_totaux_compteur
        config[year_key]["jours_travailles"] = request.jours_travailles
        self._save_all_config(config)

        # 4. Générer le PDF dans data/reports/
        pdf_filename = self._generer_pdf_vehicule(result)

        # 5. Enregistrer dans la GED comme rapport
        ged_doc_id = self._register_ged_vehicule(pdf_filename, result)

        # 6. Historique dans le barème
        bareme = self._load_bareme_vehicule(request.year)
        now = datetime.now().isoformat()
        bareme["date_derniere_application"] = now
        bareme["ratio_pro_applique"] = result.ratio_pro
        if "historique" not in bareme:
            bareme["historique"] = []
        bareme["historique"].append({
            "date": now,
            "ratio": result.ratio_pro,
            "ancien_ratio": ancien_ratio,
            "distance": request.distance_domicile_clinique_km,
            "jours": request.jours_travailles,
            "km_sup": request.km_supplementaires,
            "km_totaux": request.km_totaux_compteur,
            "pdf_filename": pdf_filename,
            "ged_doc_id": ged_doc_id,
        })
        self._save_bareme_vehicule(request.year, bareme)

        # 7. Créer ou rafraîchir l'OD signalétique au 31/12
        try:
            self._create_or_update_vehicule_od(
                year=request.year,
                ratio_pro=result.ratio_pro,
                pdf_filename=pdf_filename,
            )
        except Exception as e:
            logger.warning(f"Création OD signalétique véhicule {request.year} échouée: {e}")

        return ApplyVehiculeResponse(
            ratio_pro=result.ratio_pro,
            ancien_ratio=ancien_ratio,
            pdf_filename=pdf_filename,
            ged_doc_id=ged_doc_id,
            poste_updated=poste_updated,
        )

    def _find_vehicule_od(self, year: int) -> Optional[tuple[str, int]]:
        """Cherche l'OD signalétique véhicule existante. Retourne (filename, index) ou None."""
        marker = f"Charge forfaitaire véhicule {year}"
        for fp in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
            try:
                ops = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(ops, list):
                continue
            for i, op in enumerate(ops):
                if (op.get("source") == "vehicule"
                        and op.get("type_operation") == "OD"
                        and (op.get("Commentaire") or "").startswith(marker)):
                    return fp.name, i
        return None

    def _create_or_update_vehicule_od(
        self, year: int, ratio_pro: float, pdf_filename: str
    ) -> tuple[str, int]:
        """Crée ou met à jour l'OD signalétique véhicule au 31/12.

        L'OD est purement visuelle (Débit=0, Crédit=0) — elle sert UNIQUEMENT à
        rendre le PDF rapport quote-part visible dans l'Éditeur et la
        JustificatifsPage via le champ `Lien justificatif`. Le mécanisme de
        déduction comptable réelle reste le ratio sur poste GED `vehicule`.

        Idempotente : si une OD signalétique existe déjà pour cette année, on la
        rafraîchit (ratio, lien justif, libellé) ; sinon on l'append au fichier
        de décembre.

        Retourne (filename, index).
        """
        existing = self._find_vehicule_od(year)
        date_ecriture = f"{year}-12-31"
        libelle = f"Quote-part professionnelle véhicule {year} — ratio {ratio_pro:.0f}%"
        commentaire = (
            f"Charge forfaitaire véhicule {year} — quote-part {ratio_pro:.0f}% "
            "(OD signalétique, déduction réelle via le poste GED 'vehicule')"
        )
        lien = f"reports/{pdf_filename}"

        if existing:
            filename, idx = existing
            filepath = IMPORTS_OPERATIONS_DIR / filename
            ops = json.loads(filepath.read_text(encoding="utf-8"))
            op = ops[idx]
            op["Date"] = date_ecriture
            op["Libellé"] = libelle
            op["Débit"] = 0
            op["Crédit"] = 0
            op["Catégorie"] = "Véhicule"
            op["Sous-catégorie"] = "Quote-part professionnelle"
            op["Justificatif"] = True
            op["Lien justificatif"] = lien
            op["Commentaire"] = commentaire
            op["lettre"] = True
            op["type_operation"] = "OD"
            op["source"] = "vehicule"
            filepath.write_text(json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8")
            return filename, idx

        # Création
        target_file = self._find_or_create_december_file(year)
        filepath = IMPORTS_OPERATIONS_DIR / target_file
        ops = json.loads(filepath.read_text(encoding="utf-8"))
        od = {
            "Date": date_ecriture,
            "Libellé": libelle,
            "Débit": 0,
            "Crédit": 0,
            "Catégorie": "Véhicule",
            "Sous-catégorie": "Quote-part professionnelle",
            "Justificatif": True,
            "Lien justificatif": lien,
            "Important": False,
            "A_revoir": False,
            "Commentaire": commentaire,
            "alertes": [],
            "compte_attente": False,
            "alertes_resolues": [],
            "lettre": True,
            "type_operation": "OD",
            "source": "vehicule",
        }
        ops.append(od)
        idx = len(ops) - 1
        filepath.write_text(json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8")
        return target_file, idx

    def _remove_vehicule_od(self, year: int) -> bool:
        """Supprime l'OD signalétique véhicule. Retourne True si supprimée."""
        existing = self._find_vehicule_od(year)
        if not existing:
            return False
        filename, idx = existing
        filepath = IMPORTS_OPERATIONS_DIR / filename
        ops = json.loads(filepath.read_text(encoding="utf-8"))
        if 0 <= idx < len(ops):
            ops.pop(idx)
            filepath.write_text(json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info(f"OD signalétique véhicule {year} supprimée: {filename}#{idx}")
            return True
        return False

    # ── Véhicule : helpers internes ──

    def _get_current_vehicule_pct(self) -> Optional[float]:
        """Lit le deductible_pct actuel du poste 'vehicule' dans ged_postes.json."""
        postes_file = DATA_DIR / "ged" / "ged_postes.json"
        if not postes_file.exists():
            return None
        try:
            data = json.loads(postes_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        for p in data.get("postes", []):
            if p.get("id") == "vehicule":
                return p.get("deductible_pct")
        return None

    def _update_vehicule_poste_pct(self, new_pct: float) -> bool:
        """Met à jour le deductible_pct du poste 'vehicule' dans ged_postes.json."""
        postes_file = DATA_DIR / "ged" / "ged_postes.json"
        if not postes_file.exists():
            return False
        try:
            data = json.loads(postes_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return False
        for p in data.get("postes", []):
            if p.get("id") == "vehicule":
                p["deductible_pct"] = round(new_pct, 1)
                postes_file.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                logger.info(f"Poste véhicule mis à jour: deductible_pct={new_pct}")
                return True
        return False

    def _get_vehicule_expenses(self, year: int) -> list[dict]:
        """
        Charge toutes les opérations de l'année dans les catégories véhicule
        (Véhicule + Transport) et retourne un breakdown par sous-catégorie.
        """
        ensure_directories()
        all_ops: list[dict] = []
        vehicle_categories = {"Véhicule", "Transport"}

        for f in sorted(IMPORTS_OPERATIONS_DIR.glob("operations_*.json")):
            try:
                ops = json.loads(f.read_text(encoding="utf-8"))
                if not isinstance(ops, list):
                    continue
                for op in ops:
                    date_str = op.get("Date", "")
                    if not date_str.startswith(f"{year}-"):
                        continue
                    cat = op.get("Catégorie", "")
                    if cat not in vehicle_categories:
                        continue
                    # Ventilation : itérer les sous-lignes si présentes
                    ventilation = op.get("ventilation", [])
                    if ventilation:
                        for vl in ventilation:
                            vl_cat = vl.get("Catégorie", cat)
                            if vl_cat in vehicle_categories:
                                all_ops.append({
                                    "cat": vl_cat,
                                    "sub": vl.get("Sous-catégorie", ""),
                                    "debit": float(vl.get("Débit", 0) or 0),
                                })
                    else:
                        all_ops.append({
                            "cat": cat,
                            "sub": op.get("Sous-catégorie", ""),
                            "debit": float(op.get("Débit", 0) or 0),
                        })
            except (json.JSONDecodeError, KeyError):
                continue

        # Agréger par sous-catégorie
        breakdown: dict[str, dict] = {}
        for item in all_ops:
            label = item["sub"] or f"Non classé ({item['cat']})"
            if label not in breakdown:
                breakdown[label] = {"name": label, "brut": 0.0, "count": 0}
            breakdown[label]["brut"] += item["debit"]
            breakdown[label]["count"] += 1

        return sorted(breakdown.values(), key=lambda r: r["brut"], reverse=True)

    def _generer_pdf_vehicule(self, result: VehiculeResult) -> str:
        """PDF ReportLab A4 — récapitulatif quote-part véhicule."""
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

        filename = f"quote_part_vehicule_{result.year}.pdf"
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
        elements.append(Paragraph("Quote-part professionnelle véhicule", title_style))

        subtitle_style = ParagraphStyle(
            "Subtitle", parent=styles["Normal"], fontSize=11, textColor=colors.grey
        )
        elements.append(Paragraph(f"Exercice {result.year}", subtitle_style))
        elements.append(Spacer(1, 8 * mm))

        # Section paramètres
        section_style = ParagraphStyle(
            "Section", parent=styles["Heading2"], fontSize=12, spaceAfter=3 * mm,
            textColor=colors.HexColor("#336699"),
        )
        elements.append(Paragraph("Paramètres de calcul", section_style))

        def fmt_km(val: float) -> str:
            return f"{val:,.1f} km".replace(",", " ").replace(".", ",")

        params_data = [
            ["Distance domicile \u2192 clinique", f"{result.distance_domicile_clinique_km:g} km (aller simple)"],
            ["Jours travaillés", f"{result.jours_travailles:g}"],
            ["Km supplémentaires (gardes, formations)", fmt_km(result.km_supplementaires)],
            ["Km totaux compteur (relevé annuel)", fmt_km(result.km_totaux_compteur)],
        ]
        params_table = Table(params_data, colWidths=[80 * mm, 80 * mm])
        params_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.grey),
        ]))
        elements.append(params_table)

        # Honoraires liasse fiscale (lu depuis la config partagée)
        year_config = self.get_config(result.year)
        honoraires_liasse = year_config.get("honoraires_liasse")
        if honoraires_liasse:
            info_style = ParagraphStyle(
                "Info", parent=styles["Normal"], fontSize=10, spaceAfter=2 * mm,
            )
            elements.append(Spacer(1, 2 * mm))
            elements.append(Paragraph(
                f"Honoraires liasse fiscale SCP : <b>{honoraires_liasse:,.2f} \u20ac</b>"
                .replace(",", "\u00a0").replace(".", ",").replace("\u00a0", "\u00a0"),
                info_style,
            ))

        elements.append(Spacer(1, 6 * mm))

        # Section résultat
        elements.append(Paragraph("Résultat", section_style))

        formule = f"{result.jours_travailles:g} \u00d7 {result.distance_domicile_clinique_km:g} \u00d7 2"
        result_data = [
            ["Km trajet habituel", f"{fmt_km(result.km_trajet_habituel)} ({formule})"],
            ["Km professionnels total", fmt_km(result.km_pro_total)],
            ["Quote-part professionnelle", f"{result.ratio_pro:g} %"],
            ["Quote-part personnelle", f"{result.ratio_perso:g} %"],
        ]
        result_table = Table(result_data, colWidths=[80 * mm, 80 * mm])
        result_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
            ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#f0f7f0")),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.grey),
        ]))
        elements.append(result_table)
        elements.append(Spacer(1, 6 * mm))

        # Section application
        elements.append(Paragraph("Application", section_style))
        note_style = ParagraphStyle(
            "Note", parent=styles["Normal"], fontSize=9, leading=13,
        )
        elements.append(Paragraph(
            f"Le taux de <b>{result.ratio_pro:g}%</b> est appliqué au poste comptable Véhicule.",
            note_style,
        ))
        elements.append(Paragraph(
            "Toutes les dépenses catégorisées Véhicule sont déductibles à ce taux.",
            note_style,
        ))
        if result.ancien_ratio is not None and result.delta_ratio is not None:
            delta_sign = "+" if result.delta_ratio >= 0 else ""
            elements.append(Paragraph(
                f"Ancien taux : {result.ancien_ratio:g}% \u2192 Nouveau taux : {result.ratio_pro:g}% "
                f"(delta : {delta_sign}{result.delta_ratio:g} pts)",
                note_style,
            ))
        elements.append(Spacer(1, 8 * mm))

        # Section dépenses véhicule
        expenses = self._get_vehicule_expenses(result.year)
        if expenses:
            elements.append(Paragraph("Dépenses véhicule de l'exercice", section_style))

            def fmt_eur(val: float) -> str:
                return f"{val:,.2f} \u20ac".replace(",", "\u00a0").replace(".", ",").replace("\u00a0", "\u00a0")

            pct = result.ratio_pro / 100
            exp_header = ["Sous-catégorie", "Ops", "Montant brut", "% déduc.", "Montant déductible"]
            exp_data = [exp_header]
            total_brut = 0.0
            total_deduc = 0.0
            for row in expenses:
                brut = row["brut"]
                deduc = round(brut * pct, 2)
                total_brut += brut
                total_deduc += deduc
                exp_data.append([
                    row["name"],
                    str(row["count"]),
                    fmt_eur(brut),
                    f"{result.ratio_pro:g}%",
                    fmt_eur(deduc),
                ])
            exp_data.append([
                "Total", "", fmt_eur(total_brut), f"{result.ratio_pro:g}%", fmt_eur(round(total_deduc, 2)),
            ])

            exp_col_widths = [45 * mm, 12 * mm, 35 * mm, 22 * mm, 40 * mm]
            exp_table = Table(exp_data, colWidths=exp_col_widths)
            exp_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f0")),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("BOLD", (0, 0), (-1, 0), True),
                ("BOLD", (0, -1), (-1, -1), True),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey),
                ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("BACKGROUND", (4, -1), (4, -1), colors.HexColor("#f0f7f0")),
            ]))
            elements.append(exp_table)
        elements.append(Spacer(1, 10 * mm))

        # Pied de page
        footer_style = ParagraphStyle(
            "Footer", parent=styles["Normal"], fontSize=8, textColor=colors.grey,
        )
        elements.append(Paragraph(
            "Méthode : frais réels au prorata kilométrique", footer_style,
        ))
        now_str = datetime.now().strftime("%d/%m/%Y")
        elements.append(Paragraph(
            f"Document généré le {now_str} — NeuronXcompta", footer_style,
        ))

        doc.build(elements)
        logger.info(f"PDF véhicule généré: {filename}")
        return filename

    def _register_ged_vehicule(self, pdf_filename: str, result: VehiculeResult) -> str:
        """Enregistre le PDF véhicule dans la GED metadata."""
        from backend.services.ged_service import load_metadata, save_metadata

        src_path = REPORTS_DIR / pdf_filename
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
            "poste_comptable": "vehicule",
            "categorie": "Véhicule",
            "sous_categorie": "Quote-part professionnelle",
            "montant_brut": None,
            "deductible_pct_override": None,
            "tags": [],
            "notes": "",
            "added_at": now,
            "original_name": pdf_filename,
            "ocr_file": None,
            "fournisseur": "Véhicule",
            "date_document": f"{result.year}-12-31",
            "date_operation": f"{result.year}-12-31",
            "period": {"year": result.year, "month": 12},
            "montant": None,
            "ventilation_index": None,
            "is_reconstitue": False,
            "operation_ref": None,
            "source_module": "charges-forfaitaires",
            "rapport_meta": {
                "template_id": None,
                "title": f"Quote-part véhicule {result.year}",
                "description": (
                    f"Quote-part professionnelle {result.ratio_pro:g}% — "
                    f"{result.jours_travailles:g}j × {result.distance_domicile_clinique_km:g}km"
                ),
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
        logger.info(f"GED véhicule enregistré: {doc_id}")
        return doc_id

    # ── Véhicule : détection forfait existant ──

    def get_vehicule_genere(self, year: int) -> Optional[dict]:
        """Retourne les infos si la quote-part véhicule a été appliquée, None sinon."""
        # Ne charger que le barème exact de l'année (pas de fallback)
        target = BAREMES_DIR / f"vehicule_{year}.json"
        if not target.exists():
            return None
        bareme = json.loads(target.read_text(encoding="utf-8"))
        if bareme.get("date_derniere_application"):
            pdf_filename = f"quote_part_vehicule_{year}.pdf"
            ged_doc_id = f"data/reports/{pdf_filename}"
            last = bareme["historique"][-1] if bareme.get("historique") else {}
            return {
                "type_forfait": "vehicule",
                "ratio_pro": bareme.get("ratio_pro_applique"),
                "date_application": bareme.get("date_derniere_application"),
                "pdf_filename": pdf_filename,
                "ged_doc_id": ged_doc_id,
                "distance": last.get("distance"),
                "jours": last.get("jours"),
                "km_sup": last.get("km_sup"),
                "km_totaux": last.get("km_totaux"),
            }
        return None

    # ── Véhicule : regénération PDF seul ──

    def regenerer_pdf_vehicule(self, year: int) -> Optional[str]:
        """Regénère uniquement le PDF rapport véhicule avec les dépenses à jour. Retourne le filename ou None."""
        bareme = BAREMES_DIR / f"vehicule_{year}.json"
        if not bareme.exists():
            return None
        data = json.loads(bareme.read_text(encoding="utf-8"))
        if not data.get("date_derniere_application"):
            return None

        last = data["historique"][-1] if data.get("historique") else {}
        if not last:
            return None

        # Reconstruire le result pour le PDF
        calc_request = VehiculeRequest(
            year=year,
            distance_domicile_clinique_km=last["distance"],
            jours_travailles=last["jours"],
            km_supplementaires=last.get("km_sup", 0),
            km_totaux_compteur=last["km_totaux"],
        )
        result = self.calculer_vehicule(calc_request)

        # Regénérer le PDF (écrase l'existant)
        pdf_filename = self._generer_pdf_vehicule(result)

        # Mettre à jour la GED
        self._register_ged_vehicule(pdf_filename, result)

        logger.info(f"PDF véhicule regénéré: {pdf_filename}")
        return pdf_filename

    # ── Véhicule : suppression (pour regénérer) ──

    def supprimer_vehicule(self, year: int) -> bool:
        """Supprime PDF + GED + OD signalétique + reset barème (garde historique)."""
        bareme = self._load_bareme_vehicule(year)
        if not bareme.get("date_derniere_application"):
            return False

        # Supprimer l'OD signalétique au 31/12 (best-effort)
        try:
            self._remove_vehicule_od(year)
        except Exception as e:
            logger.warning(f"Suppression OD véhicule {year} échouée: {e}")

        # Supprimer le PDF
        pdf_path = REPORTS_DIR / f"quote_part_vehicule_{year}.pdf"
        if pdf_path.exists():
            pdf_path.unlink()
            logger.info(f"PDF véhicule supprimé: {pdf_path.name}")

        # Supprimer de la GED
        from backend.services.ged_service import load_metadata, save_metadata
        metadata = load_metadata()
        docs = metadata.get("documents", {})
        to_remove = [
            doc_id for doc_id, doc in docs.items()
            if doc.get("filename", "").startswith(f"quote_part_vehicule_{year}")
        ]
        for doc_id in to_remove:
            docs.pop(doc_id, None)
            logger.info(f"GED véhicule supprimé: {doc_id}")
        metadata["documents"] = docs
        save_metadata(metadata)

        # Réinitialiser le barème (garder l'historique)
        bareme["date_derniere_application"] = None
        bareme["ratio_pro_applique"] = None
        self._save_bareme_vehicule(year, bareme)

        return True


# ─── Module-level helpers ───

def get_total_deductible_year(year: int) -> float:
    """Total des charges forfaitaires déductibles pour une année.

    En A1 : retourne 0.0 car les OD blanchissage/repas/véhicule sont déjà inscrites
    comme opérations bancaires dans le fichier de décembre (catégorie respective)
    et donc déjà comptées dans `charges_pro` du BNC. Les ajouter ici créerait un
    double-comptage.

    Stratégie cible (Prompt C) : soit OD réelles (et `get_total_deductible_year=0`),
    soit ligne virtuelle (et exclure les catégories OD de `charges_pro`). Pas les deux.
    """
    return 0.0
