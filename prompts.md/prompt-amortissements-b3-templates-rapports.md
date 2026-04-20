# Prompt B3 — Amortissements : templates Rapports V2 (anti-duplication)

## Contexte

Après A1/A2/B1/B2, il existe **trois sources** potentielles de rapports amortissements :
- Le PDF OD généré en décembre (`amortissement_report_service.generate_dotation_pdf`) lié à l'écriture d'OD
- Le moteur `generate_dotation_pdf` appelé à la volée dans l'export ZIP
- Aucun rapport à la demande (il faut passer par l'OD pour avoir un PDF "propre")

Risques : duplication, divergence de contenu, aucun accès au rapport hors contexte OD.

Ce prompt **unifie la source** via 2 templates enregistrés dans `reports_service.TEMPLATES` avec dédup stricte par filtres. L'OD dotation (B1) et l'export ZIP (B1) convergent pour consommer ces templates au lieu de regénérer en parallèle. L'utilisateur gagne aussi un PDF/CSV/Excel à la demande depuis `/reports` sans avoir à passer par l'OD.

**Prise en compte du flag `is_reprise`** (A1/A2) : le template Registre affiche une colonne `Origine` avec badge `Reprise {year}` pour les immos reprises.

## Dépendances

**Prompts A1 + A2 + B1 + B2 exécutés et commités.** Nécessaires :
- `amortissement_report_service.generate_dotation_pdf` en place (B1)
- `amortissement_service.get_virtual_detail` + flag `is_reprise` (A1)
- `report_service.TEMPLATES` + mécanisme de dédup par filtres (existant Rapports V2)

## Périmètre

- [x] 2 templates dans `reports_service.TEMPLATES` : `amortissements_registre` + `amortissements_dotations`
- [x] Moteur de rendu partagé : `amortissement_report_service.render_registre()` et `render_dotations()` remplaçant (ou appelant) l'existant
- [x] 3 formats par template : PDF, CSV, XLSX
- [x] Helper `report_service.get_or_generate(template_id, filters, format)` → résout existant ou génère
- [x] Refactor `amortissement_service.generer_dotation_ecriture` pour appeler le template `amortissements_dotations`
- [x] Refactor `_add_amortissements_to_zip` pour consommer les templates via `get_or_generate`
- [x] UI Rapports V2 : entrée "Amortissements" dans la sélection templates + filtres
- [x] Colonne `Origine` (NeuronX / Reprise {year}) dans le template registre
- [x] Dédup validée par test : 2× génération avec mêmes filtres → 1 seul fichier + 1 seule entrée GED

## Fichiers touchés

### Backend
- `backend/services/amortissement_report_service.py` — 2 fonctions de rendu (PDF/CSV/XLSX) + `render_registre`/`render_dotations`
- `backend/services/reports_service.py` — 2 entrées dans `TEMPLATES` + mécanisme `get_or_generate` si absent
- `backend/services/amortissement_service.py` — refactor `generer_dotation_ecriture`
- `backend/services/export_service.py` — refactor `_add_amortissements_to_zip`

### Frontend
- `frontend/src/pages/ReportsPage.tsx` — exposition des 2 templates dans la sélection
- `frontend/src/components/reports/ReportsTemplateCard.tsx` — rendu des 2 cartes si pattern existant

---

## Étapes ordonnées

### Étape 1 — Refactor `amortissement_report_service`

Le service passe de "1 fonction monolithique PDF" à "2 renderers multi-format utilisés par les templates".

**`backend/services/amortissement_report_service.py`** — structure cible :

```python
from __future__ import annotations

from pathlib import Path
from io import BytesIO

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image,
)


# ─── REGISTRE ────────────────────────────────────────────────────────

def render_registre(year: int, output_path: Path, format: str, filters: dict) -> Path:
    """Registre complet des immobilisations (actives + amorties + sorties).
    Filtres : year (req), statut (all|en_cours|amorti|sorti), poste (all|<poste>)."""
    from backend.services import amortissement_service

    immos = amortissement_service.list_immobilisations_enriched(year=year)
    immos = _apply_registre_filters(immos, filters)

    if format == "pdf":
        return _render_registre_pdf(immos, year, output_path, filters)
    elif format == "csv":
        return _render_registre_csv(immos, year, output_path, filters)
    elif format == "xlsx":
        return _render_registre_xlsx(immos, year, output_path, filters)
    raise ValueError(f"Format non supporté : {format}")


def _apply_registre_filters(immos: list, filters: dict) -> list:
    statut = filters.get("statut", "all")
    poste = filters.get("poste", "all")
    if statut != "all":
        immos = [i for i in immos if i.statut == statut]
    if poste != "all":
        immos = [i for i in immos if i.poste == poste]
    return immos


def _render_registre_pdf(immos, year, output_path, filters) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=landscape(A4),  # paysage pour accueillir la colonne Origine
        leftMargin=12*mm, rightMargin=12*mm,
        topMargin=12*mm, bottomMargin=12*mm,
    )
    story = []
    styles = getSampleStyleSheet()

    logo_path = Path("backend/assets/logo_lockup_light_400.png")
    if logo_path.exists():
        story.append(Image(str(logo_path), width=55*mm, height=14*mm))
        story.append(Spacer(1, 4*mm))

    filtre_label = _describe_filters(filters)
    story.append(Paragraph(
        f"Registre des immobilisations — Exercice {year}"
        + (f" · {filtre_label}" if filtre_label else ""),
        styles["Title"],
    ))
    story.append(Spacer(1, 3*mm))

    headers = [
        "Désignation", "Origine", "Acquis le", "Statut",
        "Durée", "Base", "Cumul amort.", "VNC actuelle", "Poste",
    ]
    data = [headers]

    for immo in immos:
        origine = (
            f"Reprise {immo.exercice_entree_neuronx}"
            if immo.exercice_entree_neuronx else "NeuronX"
        )
        cumul_amort = immo.base_amortissable - immo.vnc_actuelle
        data.append([
            (immo.designation[:35] + "…") if len(immo.designation) > 35 else immo.designation,
            origine,
            _format_date_fr(immo.date_acquisition),
            immo.statut,
            f"{immo.duree} ans",
            _fr_euro(immo.base_amortissable),
            _fr_euro(cumul_amort),
            _fr_euro(immo.vnc_actuelle),
            immo.poste or "—",
        ])

    # Ligne totaux
    total_base = sum(i.base_amortissable for i in immos)
    total_vnc = sum(i.vnc_actuelle for i in immos)
    total_cumul = total_base - total_vnc
    data.append([
        "TOTAL", "", "", f"{len(immos)} immos", "",
        _fr_euro(total_base), _fr_euro(total_cumul), _fr_euro(total_vnc), "",
    ])

    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("ALIGN", (5, 1), (7, -1), "RIGHT"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EEEDFE")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        # Colorer la colonne Origine en ambre pour les reprises
        # Pour chaque ligne où c'est "Reprise X" appliquer un TEXTCOLOR spécifique
    ]))

    # Coloration ligne par ligne pour Origine "Reprise"
    ts = TableStyle()
    for row_idx, row in enumerate(data[1:-1], start=1):
        if row[1].startswith("Reprise"):
            ts.add("TEXTCOLOR", (1, row_idx), (1, row_idx), colors.HexColor("#854F0B"))
            ts.add("BACKGROUND", (1, row_idx), (1, row_idx), colors.HexColor("#FAEEDA"))
    table.setStyle(ts)

    story.append(table)
    story.append(Spacer(1, 6*mm))

    ref_style = ParagraphStyle("ref", parent=styles["Italic"], fontSize=8, textColor=colors.HexColor("#666666"))
    story.append(Paragraph(
        "Référence : art. 39-1-2° du CGI, PCG art. 214-13. Régime BNC recettes — amortissement linéaire.",
        ref_style,
    ))

    doc.build(story)
    return output_path


def _render_registre_csv(immos, year, output_path, filters) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "Désignation;Origine;Acquis le;Statut;Mode;Durée;Base amortissable;"
        "Cumul amortissements;VNC actuelle;Quote-part;Poste;Exercice entrée NeuronX"
    ]
    for immo in immos:
        origine = f"Reprise {immo.exercice_entree_neuronx}" if immo.exercice_entree_neuronx else "NeuronX"
        cumul = immo.base_amortissable - immo.vnc_actuelle
        lines.append(";".join([
            immo.designation,
            origine,
            immo.date_acquisition,
            immo.statut,
            immo.mode,
            str(immo.duree),
            _fr_decimal(immo.base_amortissable),
            _fr_decimal(cumul),
            _fr_decimal(immo.vnc_actuelle),
            f"{immo.quote_part_pro:.0f}",
            immo.poste or "",
            str(immo.exercice_entree_neuronx or ""),
        ]))

    content = "\r\n".join(lines)
    output_path.write_bytes(b"\xef\xbb\xbf" + content.encode("utf-8"))  # BOM
    return output_path


def _render_registre_xlsx(immos, year, output_path, filters) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = f"Registre {year}"

    headers = [
        "Désignation", "Origine", "Acquis le", "Statut", "Mode", "Durée",
        "Base amortissable", "Cumul amortissements", "VNC actuelle",
        "Quote-part (%)", "Poste",
    ]
    ws.append(headers)

    # Style en-tête
    header_fill = PatternFill(start_color="3C3489", end_color="3C3489", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font

    for immo in immos:
        origine = f"Reprise {immo.exercice_entree_neuronx}" if immo.exercice_entree_neuronx else "NeuronX"
        cumul = immo.base_amortissable - immo.vnc_actuelle
        ws.append([
            immo.designation, origine, immo.date_acquisition, immo.statut,
            immo.mode, immo.duree,
            immo.base_amortissable, cumul, immo.vnc_actuelle,
            immo.quote_part_pro, immo.poste or "",
        ])

    # Format nombres EUR
    for col_letter in ("G", "H", "I"):
        for cell in ws[col_letter][1:]:
            cell.number_format = "#,##0.00 €"

    # Formules SUM en pied de tableau
    last_row = ws.max_row
    total_row = last_row + 1
    ws.cell(row=total_row, column=1, value="TOTAL").font = Font(bold=True)
    ws.cell(row=total_row, column=7, value=f"=SUM(G2:G{last_row})").number_format = "#,##0.00 €"
    ws.cell(row=total_row, column=8, value=f"=SUM(H2:H{last_row})").number_format = "#,##0.00 €"
    ws.cell(row=total_row, column=9, value=f"=SUM(I2:I{last_row})").number_format = "#,##0.00 €"
    for cell in ws[total_row]:
        cell.fill = PatternFill(start_color="EEEDFE", end_color="EEEDFE", fill_type="solid")

    # Auto-width
    for col in ws.columns:
        max_len = max((len(str(c.value)) if c.value else 0) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)

    wb.save(output_path)
    return output_path


# ─── DOTATIONS ───────────────────────────────────────────────────────

def render_dotations(year: int, output_path: Path, format: str, filters: dict) -> Path:
    """Tableau des dotations de l'exercice.
    Filtres : year (req), poste (all|<poste>)."""
    from backend.services import amortissement_service

    detail = amortissement_service.get_virtual_detail(year)
    if filters.get("poste", "all") != "all":
        detail.immos = [i for i in detail.immos if i.poste == filters["poste"]]

    if format == "pdf":
        return _render_dotations_pdf(detail, year, output_path, filters)
    elif format == "csv":
        return _render_dotations_csv(detail, year, output_path, filters)
    elif format == "xlsx":
        return _render_dotations_xlsx(detail, year, output_path, filters)
    raise ValueError(f"Format non supporté : {format}")


def _render_dotations_pdf(detail, year, output_path, filters) -> Path:
    """Remplace l'ancien generate_dotation_pdf — même structure."""
    # Code identique à B1 generate_dotation_pdf, mais prenant `detail` en argument
    # au lieu de le recharger. Ajouter badge "Reprise" dans colonne Origine si
    # immo.is_reprise. Structure : logo + titre + tableau + totaux + référence.
    ...


def _render_dotations_csv(detail, year, output_path, filters) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "Désignation;Origine;Acquis le;Mode;Durée;Base;VNC début;"
        "Dotation brute;Quote-part;Dotation déductible;VNC fin;Poste"
    ]
    for immo in detail.immos:
        origine = f"Reprise {immo.exercice_entree_neuronx}" if immo.is_reprise else "NeuronX"
        lines.append(";".join([
            immo.designation, origine, immo.date_acquisition, immo.mode,
            str(immo.duree),
            _fr_decimal(immo.base_amortissable),
            _fr_decimal(immo.vnc_debut),
            _fr_decimal(immo.dotation_brute),
            f"{immo.quote_part_pro:.0f}",
            _fr_decimal(immo.dotation_deductible),
            _fr_decimal(immo.vnc_fin),
            immo.poste or "",
        ]))
    # Ligne TOTAL
    lines.append(f";;;;;;TOTAL;{_fr_decimal(detail.total_brute)};;{_fr_decimal(detail.total_deductible)};;")

    content = "\r\n".join(lines)
    output_path.write_bytes(b"\xef\xbb\xbf" + content.encode("utf-8"))
    return output_path


def _render_dotations_xlsx(detail, year, output_path, filters) -> Path:
    # Pattern identique au _render_registre_xlsx avec les colonnes dotations
    ...


# ─── HELPERS ─────────────────────────────────────────────────────────

def _fr_euro(montant: float) -> str:
    return f"{montant:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _fr_decimal(montant: float) -> str:
    """Décimal FR sans € (pour CSV)."""
    return f"{montant:.2f}".replace(".", ",")


def _format_date_fr(iso: str) -> str:
    if not iso or len(iso) < 10:
        return iso or ""
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"


def _describe_filters(filters: dict) -> str:
    parts = []
    if filters.get("statut", "all") != "all":
        parts.append(f"statut : {filters['statut']}")
    if filters.get("poste", "all") != "all":
        parts.append(f"poste : {filters['poste']}")
    return ", ".join(parts)


# ─── BACKWARD COMPAT ────────────────────────────────────────────────

def generate_dotation_pdf(year: int, output_path: Path) -> Path:
    """DEPRECATED — maintenu pour compat B1. Utilise render_dotations."""
    return render_dotations(year, output_path, "pdf", {"poste": "all"})
```

**Helper backend nécessaire** : `amortissement_service.list_immobilisations_enriched(year)` retourne toutes les immos avec champs calculés (`vnc_actuelle`, `avancement_pct`) — s'assurer qu'il existe (déjà mentionné dans `api-reference.md`).

### Étape 2 — Templates dans `reports_service`

**`backend/services/reports_service.py`** — ajouter aux `TEMPLATES` :

```python
from backend.services import amortissement_report_service


AMORTISSEMENTS_REGISTRE_TEMPLATE = {
    "id": "amortissements_registre",
    "name": "Registre des immobilisations",
    "description": "État complet du registre (actives, amorties, sorties)",
    "category": "Amortissements",
    "icon": "Package",
    "filters_schema": [
        {"key": "year", "type": "int", "required": True},
        {"key": "statut", "type": "select", "options": ["all", "en_cours", "amorti", "sorti"], "default": "all"},
        {"key": "poste", "type": "select", "options": "dynamic:postes", "default": "all"},
    ],
    "formats": ["pdf", "csv", "xlsx"],
    "renderer": amortissement_report_service.render_registre,
    "dedup_key": lambda f: f"amort_registre_{f['year']}_{f.get('statut', 'all')}_{f.get('poste', 'all')}",
    "title_builder": lambda f: (
        f"Registre immobilisations {f['year']}"
        + (f" · {f['statut']}" if f.get('statut', 'all') != 'all' else "")
        + (f" · poste {f['poste']}" if f.get('poste', 'all') != 'all' else "")
    ),
}

AMORTISSEMENTS_DOTATIONS_TEMPLATE = {
    "id": "amortissements_dotations",
    "name": "Tableau des dotations",
    "description": "Dotations de l'exercice par immobilisation",
    "category": "Amortissements",
    "icon": "TrendingDown",
    "filters_schema": [
        {"key": "year", "type": "int", "required": True},
        {"key": "poste", "type": "select", "options": "dynamic:postes", "default": "all"},
    ],
    "formats": ["pdf", "csv", "xlsx"],
    "renderer": amortissement_report_service.render_dotations,
    "dedup_key": lambda f: f"amort_dotations_{f['year']}_{f.get('poste', 'all')}",
    "title_builder": lambda f: (
        f"Tableau dotations {f['year']}"
        + (f" · poste {f['poste']}" if f.get('poste', 'all') != 'all' else "")
    ),
}


TEMPLATES = [
    # ... templates existants (BNC annuel, Ventilation charges, Récapitulatif social)
    AMORTISSEMENTS_REGISTRE_TEMPLATE,
    AMORTISSEMENTS_DOTATIONS_TEMPLATE,
]
```

**Adapter à la structure réelle** de `TEMPLATES` existant — si elle utilise des classes, des tuples, ou un registre différent. L'important est que la **clé de dédup** soit stable par filtres (pas par montant, ni par timestamp).

### Étape 3 — Helper `get_or_generate`

**`backend/services/reports_service.py`** — ajouter si absent :

```python
def get_or_generate(template_id: str, filters: dict, format: str) -> ReportResult:
    """Retourne le rapport existant si présent (dédup key match) ou le génère.
    Évite la duplication entre UI Rapports / OD dotation / export ZIP."""
    template = _get_template_by_id(template_id)
    if not template:
        raise ValueError(f"Template inconnu : {template_id}")

    dedup_key = template["dedup_key"](filters)
    existing = _find_existing_report(dedup_key, format)

    if existing and Path(existing.path).exists():
        return existing

    # Génère (remplace tout ancien rapport de même clé)
    return generate(template_id, filters, format)


def _find_existing_report(dedup_key: str, format: str) -> ReportResult | None:
    """Scan reports_index.json pour trouver un rapport avec cette dedup_key et format."""
    index = _load_reports_index()
    for entry in index.get("reports", []):
        if entry.get("dedup_key") == dedup_key and entry.get("format") == format:
            return ReportResult(
                path=entry["path"],
                filename=entry["filename"],
                title=entry["title"],
                dedup_key=dedup_key,
                format=format,
            )
    return None
```

Si le mécanisme de dédup utilise déjà `reports_index.json` avec une clé composite, adapter à la structure existante. Ne pas refondre le pattern.

### Étape 4 — Refactor `amortissement_service.generer_dotation_ecriture`

**`backend/services/amortissement_service.py`** — l'OD dotation consomme désormais le template au lieu de générer directement :

```python
def generer_dotation_ecriture(year: int) -> dict:
    """Génère l'OD dotation 31/12. Le PDF vient du template amortissements_dotations."""
    from backend.services import operation_service, ged_service, reports_service

    detail = get_virtual_detail(year)
    if detail.nb_immos_actives == 0:
        raise ValueError(f"Aucune immobilisation active pour l'exercice {year}")

    # 1. Supprimer l'OD existante si présente (déduplication côté OD)
    existing_ref = find_dotation_operation(year)
    if existing_ref:
        operation_service.delete_operation_by_index(
            existing_ref["filename"], existing_ref["index"]
        )

    # 2. Générer (ou récupérer) le rapport via reports_service
    report = reports_service.get_or_generate(
        template_id="amortissements_dotations",
        filters={"year": year, "poste": "all"},
        format="pdf",
    )

    # 3. Créer l'OD pointant vers ce rapport
    december_file = operation_service.find_or_create_month_file(year, 12)
    od = {
        "Date": f"{year}-12-31",
        "Libellé": f"Dotation aux amortissements {year}",
        "Débit": round(detail.total_deductible, 2),
        "Crédit": 0.0,
        "Catégorie": "Dotations aux amortissements",
        "Sous-catégorie": "",
        "Justificatif": True,
        "Lien justificatif": report.filename,
        "locked": True,
        "source": "amortissement",
        "pointage": True,
    }
    op_index = operation_service.append_operation(december_file, od)

    return {
        "status": "generated",
        "year": year,
        "filename": december_file,
        "index": op_index,
        "pdf_filename": report.filename,
        "montant_deductible": detail.total_deductible,
        "nb_immos": detail.nb_immos_actives,
    }
```

**Suppression** : ajuster `supprimer_dotation_ecriture(year)` pour **ne pas supprimer le PDF** (il vit sa vie dans Rapports V2, peut-être référencé ailleurs ou utile en consultation post-OD). Supprimer uniquement l'OD :

```python
def supprimer_dotation_ecriture(year: int) -> dict:
    """Supprime l'OD mais PAS le PDF du rapport (géré via Rapports V2)."""
    from backend.services import operation_service

    ref = find_dotation_operation(year)
    if not ref:
        return {"status": "not_found", "year": year}

    operation_service.delete_operation_by_index(ref["filename"], ref["index"])
    return {"status": "deleted", "year": year, "pdf_preserved": True}
```

**Regénération OD** : appelle simplement `generer_dotation_ecriture` qui supprime l'ancienne OD + délègue au template (dedup côté rapport gère la mise à jour du PDF si filtres identiques).

### Étape 5 — Refactor `_add_amortissements_to_zip`

**`backend/services/export_service.py`** :

```python
def _add_amortissements_to_zip(zip_file, year: int, include_amortissements: bool = True):
    if not include_amortissements:
        return

    from backend.services import amortissement_service, reports_service

    detail = amortissement_service.get_virtual_detail(year)
    if detail.nb_immos_actives == 0:
        return

    # 1. Registre (all statuts)
    registre = reports_service.get_or_generate(
        template_id="amortissements_registre",
        filters={"year": year, "statut": "all", "poste": "all"},
        format="pdf",
    )
    zip_file.write(registre.path, f"Amortissements/{registre.filename}")

    registre_csv = reports_service.get_or_generate(
        template_id="amortissements_registre",
        filters={"year": year, "statut": "all", "poste": "all"},
        format="csv",
    )
    zip_file.write(registre_csv.path, f"Amortissements/{registre_csv.filename}")

    # 2. Tableau dotations
    dotations = reports_service.get_or_generate(
        template_id="amortissements_dotations",
        filters={"year": year, "poste": "all"},
        format="pdf",
    )
    zip_file.write(dotations.path, f"Amortissements/{dotations.filename}")
```

Plus d'écriture dans `/tmp/`, plus de duplication.

### Étape 6 — UI Rapports V2

**`frontend/src/pages/ReportsPage.tsx`** — ajouter les 2 templates dans la sélection.

Si la page utilise un système de cartes de templates regroupées par catégorie, créer (ou utiliser) la catégorie `Amortissements` avec les 2 templates :

```tsx
<TemplateCategory name="Amortissements">
  <TemplateCard
    template={templates.find(t => t.id === 'amortissements_registre')!}
    onSelect={() => openTemplateDrawer('amortissements_registre')}
  />
  <TemplateCard
    template={templates.find(t => t.id === 'amortissements_dotations')!}
    onSelect={() => openTemplateDrawer('amortissements_dotations')}
  />
</TemplateCategory>
```

**Filtres du drawer** adaptent le formulaire aux `filters_schema` du template :
- `year` : input number (par défaut `useFiscalYearStore`)
- `statut` : select (Tous / En cours / Amortis / Sortis)
- `poste` : select dynamique (liste des postes depuis `useGedPostes()`)

**Format sélectionnable** : 3 cartes cliquables PDF / CSV / XLSX.

**Bouton Générer** : POST vers l'endpoint existant Rapports V2 avec `template_id`, `filters`, `format`. En cas de doublon (même `dedup_key`), le backend remplace automatiquement — toast info "Rapport existant mis à jour".

Si la page Rapports V2 n'utilise pas un pattern de cartes mais une liste déroulante ou un autre UI, **adapter** sans refonte.

---

## Tests manuels

### Génération via UI Rapports V2

1. **Template registre disponible** : `/reports` → catégorie Amortissements → 2 cartes visibles (Registre, Dotations).
2. **Génération PDF registre** : sélectionner template registre, filtres year=2026 statut=all poste=all format=PDF → clic Générer → fichier `amortissements_registre_2026.pdf` créé dans `data/reports/`, entrée dans GED, thumbnail généré, toast success.
3. **Dédup — même filtres** : regénérer avec mêmes filtres → toast "Rapport existant mis à jour", pas de 2ᵉ entrée dans la GED, PDF écrasé sur disque.
4. **Dédup — filtres différents** : générer registre avec statut=en_cours → nouveau fichier `amortissements_registre_2026_en_cours.pdf`, 2 entrées distinctes dans la GED. Re-regénérer `statut=all` → la version originale est mise à jour, pas touchée à celle statut=en_cours.
5. **CSV UTF-8 BOM** : ouvrir le CSV dans Excel → accents corrects, `;` séparateurs, virgule décimale. Ligne TOTAL en pied.
6. **XLSX formules** : ouvrir le XLSX → cellule TOTAL base contient `=SUM(G2:Gn)` évaluable, format `#,##0.00 €` sur colonnes monétaires.
7. **Colonne Origine** : immo reprise visible avec cellule "Reprise 2026" en ambre dans le PDF registre, colonne Origine dans CSV/XLSX.

### Convergence OD dotation

8. **Génération OD via onglet Dotation** : `/amortissements?tab=dotation&year=2026` → clic Générer → OD créée + PDF pointé = **le même fichier** que celui du template `amortissements_dotations` avec filtres `year=2026 poste=all`. Vérifier que `Lien justificatif` de l'OD pointe vers `amortissements_dotations_2026.pdf` (ou équivalent selon le `title_builder`).
9. **Dédup croisée** : générer d'abord le rapport dotations via Rapports V2, puis générer l'OD → 1 seul fichier PDF, 1 seule entrée GED, l'OD pointe dessus.
10. **Suppression OD préserve PDF** : supprimer l'OD dotation via onglet Dotation → l'OD disparaît de l'éditeur, **mais le rapport PDF reste dans Rapports V2** et GED.
11. **Regénération OD** : générer l'OD 2× d'affilée → 1 OD, 1 PDF (mis à jour), 1 entrée GED.

### Export ZIP

12. **ZIP consomme les templates** : `POST /exports/...` avec `include_amortissements=true` → dossier `Amortissements/` contient le registre PDF + registre CSV + tableau dotations PDF, **fichiers identiques** à ceux de Rapports V2 (vérifier SHA ou contenu visuel).
13. **ZIP sans dotation générée** : année 2027 sans OD dotation mais avec immos actives → ZIP contient quand même le registre (généré à la volée via `get_or_generate`), le tableau dotations (idem).

### Regression

14. **Rapports V2 existants intacts** : les 3 templates existants (BNC annuel, Ventilation charges, Récapitulatif social) continuent à fonctionner, dédup inchangée.
15. **Compatibilité B1** : la fonction legacy `amortissement_report_service.generate_dotation_pdf(year, path)` (si encore appelée quelque part) fonctionne toujours (wrapper vers `render_dotations`).

## CLAUDE.md — à ajouter

```markdown
- **Templates Rapports V2 amortissements** : 2 entrées dans
  `reports_service.TEMPLATES` sous catégorie `Amortissements` :
  - `amortissements_registre` — registre complet (filtres : year, statut,
    poste). Colonnes : Désignation, **Origine** (NeuronX / Reprise {year}
    badge ambre), Acquis le, Statut, Durée, Base, Cumul amort, VNC actuelle,
    Poste. Ligne TOTAL en pied. PDF paysage A4.
  - `amortissements_dotations` — dotations de l'exercice (filtres : year,
    poste). Même schéma que PDF OD dotation. 
  - Dédup par `dedup_key(filters)` (ex: `amort_registre_2026_all_all`).
    Formats : PDF (paysage pour registre, portrait pour dotations), CSV
    UTF-8 BOM avec `;`, XLSX openpyxl avec formules SUM et format `#,##0.00 €`.
  - Rendu délégué à `amortissement_report_service.render_registre()` et
    `render_dotations()`, chacun dispatchant selon le format.

- **Helper `reports_service.get_or_generate(template_id, filters, format)`** :
  retourne le rapport existant matchant la `dedup_key` + format, sinon le
  génère. Élimine la duplication entre 3 sources historiques (UI Rapports /
  OD dotation / export ZIP).

- **Convergence OD dotation → template** :
  `amortissement_service.generer_dotation_ecriture(year)` appelle désormais
  `reports_service.get_or_generate(template_id="amortissements_dotations",
  filters={year, poste: all}, format="pdf")` au lieu de générer directement.
  L'OD pointe vers le `filename` du rapport. Suppression OD préserve le
  rapport PDF (géré par Rapports V2 pour consultation hors contexte OD).
  Regénération OD met à jour le rapport via dédup côté template.

- **Convergence export ZIP → templates** : `_add_amortissements_to_zip`
  consomme `get_or_generate` au lieu de regénérer dans `/tmp/`. Les fichiers
  ZIP sont **les mêmes** que ceux dans Rapports V2 + GED. Zéro duplication.

- **`amortissement_report_service` refactor** : fonctions historiques
  `generate_dotation_pdf(year, output_path)` conservées comme wrapper vers
  `render_dotations(year, path, "pdf", {"poste": "all"})` pour backward
  compat. Nouvelles fonctions publiques : `render_registre(year, path,
  format, filters)` et `render_dotations(year, path, format, filters)`.
```

## Commits suggérés

1. `refactor(backend): amortissement_report_service multi-format (render_registre + render_dotations)`
2. `feat(backend): templates Rapports V2 amortissements + get_or_generate helper`
3. `refactor(backend): generer_dotation_ecriture consomme template amortissements_dotations`
4. `refactor(backend): _add_amortissements_to_zip consomme templates via get_or_generate`
5. `feat(frontend): UI Rapports V2 — catégorie Amortissements + 2 templates`
6. `docs: CLAUDE.md — templates Rapports V2 amortissements + anti-duplication`
