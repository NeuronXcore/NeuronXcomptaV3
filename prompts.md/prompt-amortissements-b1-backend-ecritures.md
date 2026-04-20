# Prompt B1 — Amortissements : backend écritures (OD + PDF + GED + task)

## Contexte

Les Prompts A1/A2 ont livré le cœur fiscal (BNC centralisé, ligne virtuelle, UI alignée). Maintenant il faut **matérialiser l'écriture comptable** : une OD au 31/12 qui passe la dotation en charges déductibles, avec un PDF de rapport justificatif enregistré dans la GED. Pattern strict blanchissage/repas/véhicule.

Ce prompt **backend-only** couvre la génération OD + PDF + task auto + export ZIP. Les composants UI (onglet Dotation, badges, filtres, navigation) suivent en B2.

## Dépendances

**Prompts A1 + A2 exécutés et commités.** Nécessaires :
- Catégorie `Dotations aux amortissements` seedée
- Endpoint `GET /virtual-detail?year=X` opérationnel
- Endpoint `GET /dotation-ref/{year}` opérationnel
- Constante `EXCLUDED_FROM_CHARGES_PRO` en place

## Périmètre

- [x] `amortissement_report_service.generate_dotation_pdf()` — PDF ReportLab A4 "État des amortissements"
- [x] `amortissement_service.generer_dotation_ecriture(year)` — OD + PDF + GED (idempotent)
- [x] `amortissement_service.supprimer_dotation_ecriture(year)` — cleanup complet
- [x] `amortissement_service.regenerer_pdf_dotation(year)` — PDF uniquement (pattern véhicule)
- [x] `amortissement_service.get_candidate_detail(filename, index)` — préfill OCR pour Prompt B2
- [x] 5 endpoints nouveaux dans `routers/amortissements.py`
- [x] 7ᵉ détection `dotation_manquante` dans `task_service`
- [x] Section `Amortissements/` dans l'export ZIP comptable

## Fichiers touchés

- **Créer** `backend/services/amortissement_report_service.py`
- `backend/services/amortissement_service.py` — 4 fonctions nouvelles
- `backend/routers/amortissements.py` — 5 endpoints
- `backend/services/task_service.py` — 7ᵉ détection
- `backend/services/export_service.py` — section ZIP
- `backend/models/operation.py` — vérifier enum `source` inclut `"amortissement"`

---

## Étapes ordonnées

### Étape 1 — Service PDF rapport

**Créer** `backend/services/amortissement_report_service.py` :

```python
from __future__ import annotations

from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    Image,
)


def generate_dotation_pdf(year: int, output_path: Path) -> Path:
    """Génère le PDF 'État des amortissements {year}'.
    Structure : logo + titre + tableau registre + totaux + référence légale."""
    from backend.services import amortissement_service

    detail = amortissement_service.get_virtual_detail(year)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    story = []
    styles = getSampleStyleSheet()

    # Logo
    logo_path = Path("backend/assets/logo_lockup_light_400.png")
    if logo_path.exists():
        story.append(Image(str(logo_path), width=60 * mm, height=15 * mm))
        story.append(Spacer(1, 5 * mm))

    story.append(Paragraph(
        f"État des amortissements — Exercice {year}",
        styles["Title"],
    ))
    story.append(Spacer(1, 4 * mm))

    # Tableau registre — 1 ligne par immo contributive
    headers = [
        "Désignation", "Acquis le", "Durée", "Base",
        "VNC début", "Dotation", "Q-part", "VNC fin", "Poste",
    ]
    data = [headers]
    for immo in detail.immos:
        data.append([
            (immo.designation[:35] + "…") if len(immo.designation) > 35 else immo.designation,
            _format_date_fr(immo.date_acquisition),
            f"{immo.duree} ans",
            _fr_euro(immo.base_amortissable),
            _fr_euro(immo.vnc_debut),
            _fr_euro(immo.dotation_deductible),
            f"{immo.quote_part_pro:.0f} %",
            _fr_euro(immo.vnc_fin),
            immo.poste or "—",
        ])

    # Ligne totaux
    data.append([
        "TOTAL", "", "", "",
        "",
        _fr_euro(detail.total_deductible),
        "", "", "",
    ])

    table = Table(data, repeatRows=1, colWidths=[45*mm, 20*mm, 15*mm, 22*mm, 22*mm, 22*mm, 12*mm, 22*mm, 20*mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("ALIGN", (3, 1), (7, -1), "RIGHT"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EEEDFE")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    story.append(table)
    story.append(Spacer(1, 6 * mm))

    # Récapitulatif
    story.append(Paragraph(
        f"<b>Dotation brute de l'exercice :</b> {_fr_euro(detail.total_brute)}<br/>"
        f"<b>Dotation déductible :</b> {_fr_euro(detail.total_deductible)}<br/>"
        f"<b>Immobilisations actives :</b> {detail.nb_immos_actives}",
        styles["Normal"],
    ))
    story.append(Spacer(1, 8 * mm))

    # Référence légale
    ref_style = ParagraphStyle(
        "ref",
        parent=styles["Italic"],
        fontSize=8,
        textColor=colors.HexColor("#666666"),
    )
    story.append(Paragraph(
        "Référence : art. 39-1-2° du CGI, PCG art. 214-13 (amortissement linéaire "
        "avec pro rata temporis). Régime BNC — comptabilité de recettes.",
        ref_style,
    ))

    doc.build(story)
    return output_path


def _fr_euro(montant: float) -> str:
    """1 234,56 €"""
    return f"{montant:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _format_date_fr(iso: str) -> str:
    """2024-03-15 → 15/03/2024"""
    if not iso or len(iso) < 10:
        return iso or ""
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"
```

### Étape 2 — Génération OD dotation

**`backend/services/amortissement_service.py`** — ajouter :

```python
from backend.services.amortissement_report_service import generate_dotation_pdf


def generer_dotation_ecriture(year: int) -> dict:
    """Génère l'OD dotation 31/12 + PDF + GED. Idempotent (regénère si existe)."""
    from backend.services import operation_service, ged_service

    detail = get_virtual_detail(year)
    if detail.nb_immos_actives == 0:
        raise ValueError(f"Aucune immobilisation active pour l'exercice {year}")

    # 1. Localiser ou créer le fichier décembre de l'année
    december_file = operation_service.find_or_create_month_file(year, 12)

    # 2. Si OD existante → supprimer avant de recréer (déduplication)
    existing_ref = find_dotation_operation(year)
    if existing_ref:
        operation_service.delete_operation_by_index(
            existing_ref["filename"], existing_ref["index"]
        )

    # 3. Générer le PDF
    montant_int = int(round(detail.total_deductible))
    pdf_filename = f"amortissements_{year}1231_{montant_int}.pdf"
    pdf_path = Path("data/reports") / pdf_filename
    generate_dotation_pdf(year, pdf_path)

    # 4. Construire l'OD
    od = {
        "Date": f"{year}-12-31",
        "Libellé": f"Dotation aux amortissements {year}",
        "Débit": round(detail.total_deductible, 2),
        "Crédit": 0.0,
        "Catégorie": "Dotations aux amortissements",
        "Sous-catégorie": "",
        "Justificatif": True,
        "Lien justificatif": pdf_filename,
        "locked": True,
        "source": "amortissement",
        "pointage": True,
    }
    op_index = operation_service.append_operation(december_file, od)

    # 5. Enregistrer dans la GED comme rapport
    ged_service.register_rapport(
        filepath=str(pdf_path),
        report_type="amortissement",
        year=year,
        month=12,
        title=f"État des amortissements {year}",
        categorie="Dotations aux amortissements",
    )

    return {
        "status": "generated",
        "year": year,
        "filename": december_file,
        "index": op_index,
        "pdf_filename": pdf_filename,
        "montant_deductible": detail.total_deductible,
        "nb_immos": detail.nb_immos_actives,
    }


def supprimer_dotation_ecriture(year: int) -> dict:
    """Supprime OD + PDF + entrée GED."""
    from backend.services import operation_service, ged_service

    ref = find_dotation_operation(year)
    if not ref:
        return {"status": "not_found", "year": year}

    ops = operation_service.load_operations(ref["filename"])
    pdf_filename = ops[ref["index"]].get("Lien justificatif")

    operation_service.delete_operation_by_index(ref["filename"], ref["index"])

    if pdf_filename:
        pdf_path = Path("data/reports") / pdf_filename
        pdf_path.unlink(missing_ok=True)
        ged_service.remove_document(f"data/reports/{pdf_filename}")

    return {"status": "deleted", "year": year, "pdf_removed": bool(pdf_filename)}


def regenerer_pdf_dotation(year: int) -> dict:
    """Regénère uniquement le PDF sans toucher à l'OD (pattern véhicule)."""
    from backend.services import operation_service, ged_service

    ref = find_dotation_operation(year)
    if not ref:
        raise ValueError(f"OD dotation {year} introuvable — générer d'abord")

    ops = operation_service.load_operations(ref["filename"])
    pdf_filename = ops[ref["index"]].get("Lien justificatif")
    pdf_path = Path("data/reports") / pdf_filename

    generate_dotation_pdf(year, pdf_path)

    # Invalidate thumbnail GED (le PDF a changé)
    ged_service.touch_document(f"data/reports/{pdf_filename}")

    return {"status": "regenerated", "year": year, "pdf_filename": pdf_filename}
```

**Points d'attention** :
- `operation_service.find_or_create_month_file(year, 12)` — adapter au nom réel. Voir le pattern de Note de frais qui utilise `operation_service.create_empty_file(year, month)`. Besoin d'un helper `find_or_create` qui retourne le fichier existant si présent ou en crée un vide sinon.
- `operation_service.append_operation(filename, op_dict)` — helper qui charge, append, sauvegarde et retourne l'index
- `operation_service.delete_operation_by_index(filename, index)` — à créer ou adapter
- `ged_service.register_rapport` / `remove_document` / `touch_document` — vérifier les signatures exactes (sinon inspecter le code)

### Étape 3 — `get_candidate_detail`

**`backend/services/amortissement_service.py`** :

```python
def get_candidate_detail(filename: str, index: int) -> dict:
    """Retourne op + justificatif + préfill OCR pour ImmobilisationDrawer (Prompt B2)."""
    from backend.services import (
        operation_service,
        justificatif_service,
        ocr_service,
    )

    ops = operation_service.load_operations(filename)
    if index >= len(ops):
        raise ValueError(f"Index {index} hors limites pour {filename}")

    op = ops[index]
    justif_filename = op.get("Lien justificatif")

    # Préfill défaut depuis l'op
    ocr_prefill = {
        "designation": op.get("Libellé", ""),
        "date_acquisition": op.get("Date", ""),
        "base_amortissable": abs(op.get("Débit", 0) or 0),
    }

    justificatif = None
    if justif_filename:
        justif_path = justificatif_service.resolve_justificatif_path(justif_filename)
        if justif_path:
            ocr_data = ocr_service.load_ocr_json(justif_filename) or {}
            justificatif = {
                "filename": justif_filename,
                "ocr_data": ocr_data,
            }

            # Préfill prioritaire depuis OCR si présent
            if ocr_data.get("supplier"):
                libelle = op.get("Libellé", "")
                ocr_prefill["designation"] = (
                    f"{ocr_data['supplier']} — {libelle}" if libelle
                    else ocr_data["supplier"]
                )
            if ocr_data.get("best_date"):
                ocr_prefill["date_acquisition"] = ocr_data["best_date"]
            if ocr_data.get("best_amount"):
                ocr_prefill["base_amortissable"] = ocr_data["best_amount"]

    return {
        "operation": op,
        "justificatif": justificatif,
        "ocr_prefill": ocr_prefill,
    }
```

### Étape 4 — Endpoints

**`backend/routers/amortissements.py`** :

```python
from fastapi import Query


@router.post("/generer-dotation")
def post_generer_dotation(year: int = Query(...)) -> dict:
    return amortissement_service.generer_dotation_ecriture(year)


@router.delete("/supprimer-dotation")
def delete_supprimer_dotation(year: int = Query(...)) -> dict:
    return amortissement_service.supprimer_dotation_ecriture(year)


@router.post("/regenerer-pdf-dotation")
def post_regenerer_pdf(year: int = Query(...)) -> dict:
    return amortissement_service.regenerer_pdf_dotation(year)


@router.get("/candidate-detail")
def get_candidate_detail_endpoint(
    filename: str = Query(...),
    index: int = Query(...),
) -> dict:
    return amortissement_service.get_candidate_detail(filename, index)


@router.get("/dotation-genere")
def get_dotation_genere(year: int = Query(...)) -> dict | None:
    """Retourne les infos de l'OD si générée, sinon None (pattern véhicule)."""
    from backend.services import operation_service

    ref = amortissement_service.find_dotation_operation(year)
    if not ref:
        return None
    ops = operation_service.load_operations(ref["filename"])
    op = ops[ref["index"]]
    pdf_filename = op.get("Lien justificatif")
    return {
        "year": year,
        "pdf_filename": pdf_filename,
        "ged_doc_id": f"data/reports/{pdf_filename}" if pdf_filename else None,
        "montant": abs(op.get("Débit", 0)),
        "filename": ref["filename"],
        "index": ref["index"],
    }
```

### Étape 5 — Tâche auto `dotation_manquante`

**`backend/services/task_service.py`** — ajouter 7ᵉ détection dans `generate_auto_tasks(year)` :

```python
def _detect_dotation_manquante(year: int) -> list[AutoTaskData]:
    """7ᵉ détection : OD dotation aux amortissements à générer."""
    from datetime import date
    from backend.services import amortissement_service

    today = date.today()
    # Déclenche si exercice clos OU nous sommes après le 31/12 de l'année
    year_is_past = today.year > year or (today.year == year and today.month >= 12)
    if not year_is_past:
        return []

    # Déjà générée ?
    if amortissement_service.find_dotation_operation(year):
        return []

    # Y a-t-il des immos contributives ?
    detail = amortissement_service.get_virtual_detail(year)
    if detail.nb_immos_actives == 0:
        return []

    return [AutoTaskData(
        auto_key=f"dotation_manquante_{year}",
        title=f"Générer la dotation aux amortissements {year}",
        description=(
            f"{detail.nb_immos_actives} immo(s) active(s) · "
            f"dotation déductible {detail.total_deductible:.2f} €"
        ),
        priority=TaskPriority.HIGH,
        action_link=f"/amortissements?tab=dotation&year={year}",
    )]
```

Intégrer l'appel dans l'orchestrateur `generate_auto_tasks` au même niveau que les 6 détections existantes. Mettre à jour le log "6 détections" → "7 détections" où applicable.

### Étape 6 — Export ZIP section Amortissements

**`backend/services/export_service.py`** — ajouter un helper :

```python
def _add_amortissements_to_zip(zip_file, year: int, include_amortissements: bool = True):
    """Ajoute la section Amortissements/ au ZIP comptable."""
    if not include_amortissements:
        return

    from pathlib import Path
    from backend.services import amortissement_service, operation_service
    from backend.services.amortissement_report_service import generate_dotation_pdf

    detail = amortissement_service.get_virtual_detail(year)
    if detail.nb_immos_actives == 0:
        return

    # 1. Rapport de dotation OD (si généré)
    ref = amortissement_service.find_dotation_operation(year)
    if ref:
        ops = operation_service.load_operations(ref["filename"])
        pdf_name = ops[ref["index"]].get("Lien justificatif")
        pdf_path = Path("data/reports") / pdf_name
        if pdf_path.exists():
            zip_file.write(pdf_path, f"Amortissements/{pdf_name}")

    # 2. Registre PDF (tous statuts, généré à la volée)
    # Si pas d'OD encore générée, créer une version temporaire du rapport
    if not ref:
        tmp_path = Path(f"/tmp/registre_{year}.pdf")
        generate_dotation_pdf(year, tmp_path)
        zip_file.write(tmp_path, f"Amortissements/registre_immobilisations_{year}.pdf")
        tmp_path.unlink(missing_ok=True)

    # 3. CSV registre (consommation comptable)
    csv_content = _generate_registre_csv(detail)
    zip_file.writestr(
        f"Amortissements/registre_immobilisations_{year}.csv",
        csv_content.encode("utf-8-sig"),  # BOM pour Excel
    )


def _generate_registre_csv(detail) -> str:
    """CSV compatible Excel français (; séparateur, virgule décimale, BOM)."""
    lines = [
        "Désignation;Acquis le;Mode;Durée;Base;VNC début;Dotation brute;"
        "Quote-part;Dotation déductible;VNC fin;Poste"
    ]
    for immo in detail.immos:
        lines.append(";".join([
            immo.designation,
            immo.date_acquisition,
            immo.mode,
            str(immo.duree),
            f"{immo.base_amortissable:.2f}".replace(".", ","),
            f"{immo.vnc_debut:.2f}".replace(".", ","),
            f"{immo.dotation_brute:.2f}".replace(".", ","),
            f"{immo.quote_part_pro:.0f}",
            f"{immo.dotation_deductible:.2f}".replace(".", ","),
            f"{immo.vnc_fin:.2f}".replace(".", ","),
            immo.poste or "",
        ]))
    lines.append("")
    lines.append(f";;;TOTAL;;;{detail.total_brute:.2f};;{detail.total_deductible:.2f};;")
    return "\r\n".join(lines).replace(".", ",", lines.count(".") - 10)  # adapter si nécessaire
```

**Intégration** dans la fonction principale de build ZIP :
- Ajouter un champ `include_amortissements: bool = True` à `ExportRequest` (Pydantic model)
- Appeler `_add_amortissements_to_zip(zip_file, year, request.include_amortissements)` au bon endroit dans le flux

---

## Tests manuels

1. **Génération idempotente** : `POST /generer-dotation?year=2026` 2× d'affilée → 2ᵉ appel supprime l'ancienne OD + regénère (pas de doublon). Vérifier dans le JSON ops de décembre qu'il n'y a qu'une seule ligne `source == "amortissement"`.
2. **PDF valide** : ouvrir `data/reports/amortissements_2026*.pdf` → logo présent, tableau lisible, totaux cohérents avec `/virtual-detail`.
3. **GED** : après génération, le rapport apparaît dans `/ged?type=rapport` avec `report_type: "amortissement"` et thumbnail PNG.
4. **OD bien formée** : l'op générée a `Date: "2026-12-31"`, `Catégorie: "Dotations aux amortissements"`, `Débit: {total_deductible}`, `locked: true`, `source: "amortissement"`, `Justificatif: true`.
5. **Suppression propre** : `DELETE /supprimer-dotation?year=2026` → OD disparue du fichier JSON, PDF disque supprimé, entrée GED disparue.
6. **Regénération PDF seule** : `POST /regenerer-pdf-dotation?year=2026` → PDF mis à jour avec date modification récente, OD non touchée.
7. **candidate-detail avec OCR** : `GET /candidate-detail?filename=X&index=Y` sur une op avec justif OCR → `ocr_prefill.designation` commence par le supplier, `ocr_prefill.base_amortissable` = `best_amount`.
8. **candidate-detail sans justif** : même endpoint sur op sans justif → `justificatif: null`, `ocr_prefill` construit depuis l'op bancaire seulement.
9. **Task auto en janvier N+1** : simuler date = 2027-01-15, 3 immos actives pour 2026, aucune OD 2026 → après `/api/tasks/refresh?year=2026`, tâche `dotation_manquante_2026` présente.
10. **Task idempotente** : générer l'OD → tâche `dotation_manquante` doit disparaître au prochain refresh (dédup par `auto_key`).
11. **Export ZIP** : `POST /exports/...` avec `include_amortissements: true` sur 2026 → ZIP contient dossier `Amortissements/` avec registre PDF + CSV + rapport OD.
12. **BNC post-OD cohérent** : après génération de l'OD, `GET /analytics/dashboard?year=2026` retourne bien la catégorie `Dotations aux amortissements` **soit** en ligne virtuelle **soit** en ligne bancaire de l'OD — **pas les deux** (l'OD est dans `EXCLUDED_FROM_CHARGES_PRO` donc pas agrégée comme charge, et la ligne virtuelle reste la source de vérité).

**Point critique — test 12** : vérifier le comportement. L'OD a `Catégorie == "Dotations aux amortissements"` qui est dans `EXCLUDED_FROM_CHARGES_PRO` → elle est exclue de charges_pro. La ligne virtuelle vient de `amortissement_service.get_dotations()`. **Pas de double-comptage**. Si l'OD apparaît quand même comme ligne bancaire de catégorie `Dotations aux amortissements` dans le dashboard, c'est OK pour la traçabilité tant que `total_debit` n'est pas comptée dans `charges_pro` (à vérifier dans le code de `get_dashboard`).

## CLAUDE.md — à ajouter

```markdown
- **OD dotation amortissements** : `amortissement_service.generer_dotation_ecriture(year)`
  crée l'OD au 31/12 avec `Catégorie: "Dotations aux amortissements"`,
  `source: "amortissement"`, `locked: true`, lien vers PDF généré par
  `amortissement_report_service.generate_dotation_pdf()` (ReportLab A4 :
  logo + titre + tableau registre + totaux violet + référence légale
  art. 39 CGI / PCG 214-13). Idempotent (regénère via `find_dotation_operation`
  → suppression → recréation). GED auto-enregistré comme `report_type:
  "amortissement"`. Pattern strict blanchissage/repas/véhicule.

- **Endpoints OD dotation** :
  - `POST /api/amortissements/generer-dotation?year=X`
  - `DELETE /api/amortissements/supprimer-dotation?year=X`
  - `POST /api/amortissements/regenerer-pdf-dotation?year=X` (PDF seul, pattern véhicule)
  - `GET /api/amortissements/candidate-detail?filename=X&index=N` (op + justif + préfill OCR, pour ImmobilisationDrawer Prompt B2)
  - `GET /api/amortissements/dotation-genere?year=X` (métadonnées si OD existe)

- **Task auto dotation_manquante** : 7ᵉ détection dans
  `task_service.generate_auto_tasks(year)`. Déclenche si (today.year > year
  OU today.month >= 12) ET aucune OD dotation ET immos contributives > 0.
  `auto_key: dotation_manquante_{year}`, priority HIGH,
  `action_link: /amortissements?tab=dotation&year={year}`.

- **Export ZIP — section Amortissements** : `_add_amortissements_to_zip()`
  produit `Amortissements/registre_immobilisations_{year}.pdf`, `.csv` et le
  rapport OD si présent. Toggle `include_amortissements: bool = True` dans
  `ExportRequest`. CSV UTF-8-BOM compatible Excel FR.
```

## Commits suggérés

1. `feat(backend): amortissement_report_service.generate_dotation_pdf`
2. `feat(backend): OD dotation generer/supprimer/regenerer + endpoints`
3. `feat(backend): candidate-detail endpoint avec préfill OCR`
4. `feat(backend): task auto dotation_manquante (7e détection)`
5. `feat(backend): export ZIP section Amortissements`
6. `docs: CLAUDE.md — backend écritures amortissements`
