# Prompt : Module Charges Forfaitaires — Blanchissage

## Contexte

Nouveau module **Charges forfaitaires** dans le groupe CLÔTURE de la sidebar (après Amortissements). Première brique : les frais de blanchissage professionnel. La page est conçue pour accueillir d'autres onglets plus tard (véhicule, IK…).

Le blanchissage :
- Utilise un **barème JSON versionné par année** (même pattern que `data/baremes/urssaf_2024.json`)
- Prend en entrée un **nombre de jours travaillés** (saisie manuelle)
- Calcule le montant déductible selon le barème et le taux de décote en vigueur (BOI-BNC-BASE-40-20)
- Génère une **OD** (opération diverse, pas de mouvement bancaire) dans le fichier d'opérations de décembre
- Génère un **PDF reconstitué** (ReportLab) auto-titré, rattaché à l'OD et enregistré dans la GED
- S'intègre dans la **Simulation BNC** via une checkbox toggle

---

## Architecture

### Sidebar

```
CLÔTURE
├── Export Comptable
├── Clôture
├── Amortissements
└── Charges forfaitaires   ← NEW (icône: Receipt)
```

### Route

```
/charges-forfaitaires → ChargesForfaitairesPage
```

Pour l'instant un seul onglet "Blanchissage". La structure onglets est en place pour ajouter "Véhicule" ensuite.

---

## Étape 1 — Barème JSON

### Créer `data/baremes/blanchissage_2025.json`

```json
{
  "annee": 2025,
  "reference_legale": "BOI-BNC-BASE-40-20",
  "mode_defaut": "domicile",
  "decote_domicile": 0.30,
  "articles": [
    { "type": "Blouse médicale", "tarif_pressing": 7.00, "quantite_jour": 1 },
    { "type": "Pantalon médical", "tarif_pressing": 8.00, "quantite_jour": 1 },
    { "type": "Serviette de soins", "tarif_pressing": 2.00, "quantite_jour": 2 }
  ]
}
```

### Chargement

Ajouter le type `blanchissage` dans le chargeur de barèmes existant (`fiscal_service.py` ou `simulation_router.py`) :
- `GET /api/simulation/baremes/blanchissage?year=2025`
- Même logique de fallback que les autres barèmes : si `blanchissage_2025.json` n'existe pas, charger l'année la plus récente disponible
- `PUT /api/simulation/baremes/blanchissage?year=2025` pour modifier les articles/tarifs

---

## Étape 2 — Backend Models

### Créer `backend/models/charges_forfaitaires.py`

```python
from pydantic import BaseModel
from typing import Optional
from enum import Enum


class TypeForfait(str, Enum):
    BLANCHISSAGE = "blanchissage"
    VEHICULE = "vehicule"  # prévu, pas implémenté


class ModeBlanchissage(str, Enum):
    DOMICILE = "domicile"
    PRESSING = "pressing"


class ArticleBlanchissage(BaseModel):
    type: str
    tarif_pressing: float
    quantite_jour: int


class BaremeBlanchissage(BaseModel):
    annee: int
    reference_legale: str
    mode_defaut: str
    decote_domicile: float
    articles: list[ArticleBlanchissage]


class BlanchissageRequest(BaseModel):
    year: int
    jours_travailles: int
    mode: ModeBlanchissage = ModeBlanchissage.DOMICILE


class ArticleDetail(BaseModel):
    type: str
    tarif_pressing: float
    montant_unitaire: float  # après décote éventuelle
    quantite_jour: int
    jours: int
    sous_total: float


class ForfaitResult(BaseModel):
    type_forfait: TypeForfait
    year: int
    montant_total: float
    montant_deductible: float
    detail: list[ArticleDetail]
    reference_legale: str
    mode: str
    decote: float  # 0.30 ou 0.0
    jours_travailles: int
    cout_jour: float


class GenerateODRequest(BaseModel):
    type_forfait: TypeForfait
    year: int
    jours_travailles: int
    mode: ModeBlanchissage = ModeBlanchissage.DOMICILE
    date_ecriture: str = ""  # défaut : 31/12/{year}


class GenerateODResponse(BaseModel):
    od_filename: str
    od_index: int
    pdf_filename: str
    ged_doc_id: str
    montant: float
```

---

## Étape 3 — Backend Service

### Créer `backend/services/charges_forfaitaires_service.py`

```python
import json
import os
from datetime import datetime
from pathlib import Path

from backend.models.charges_forfaitaires import (
    TypeForfait, ModeBlanchissage, BlanchissageRequest,
    ArticleDetail, ForfaitResult, GenerateODRequest, GenerateODResponse,
    BaremeBlanchissage,
)


DATA_DIR = Path("data")
BAREMES_DIR = DATA_DIR / "baremes"
OPERATIONS_DIR = DATA_DIR / "imports" / "operations"


class ChargesForfaitairesService:

    # ── Chargement barème ──

    def _load_bareme_blanchissage(self, year: int) -> BaremeBlanchissage:
        """
        Charge baremes/blanchissage_{year}.json.
        Fallback : année la plus récente disponible.
        Raise FileNotFoundError si aucun barème trouvé.
        """
        target = BAREMES_DIR / f"blanchissage_{year}.json"
        if target.exists():
            data = json.loads(target.read_text(encoding="utf-8"))
            return BaremeBlanchissage(**data)

        # Fallback : trouver le plus récent
        candidates = sorted(BAREMES_DIR.glob("blanchissage_*.json"), reverse=True)
        if not candidates:
            raise FileNotFoundError(f"Aucun barème blanchissage trouvé")
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

        details = []
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
        )

    # ── Génération OD ──

    def generer_od(self, request: GenerateODRequest) -> GenerateODResponse:
        """
        1. Calculer le montant
        2. Trouver/créer le fichier opérations de décembre {year}
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
        filepath = OPERATIONS_DIR / target_file
        operations = json.loads(filepath.read_text(encoding="utf-8"))

        # Vérifier doublon : même type + même année dans commentaire
        doublon_marker = f"Charge forfaitaire blanchissage {request.year}"
        for op in operations:
            if op.get("commentaire", "").startswith(doublon_marker):
                raise ValueError(
                    f"Un forfait blanchissage existe déjà pour {request.year} dans {target_file}"
                )

        # Créer l'opération OD
        od = {
            "date": date_ecriture,
            "libelle": f"Frais de blanchissage professionnel {request.year}",
            "montant": -result.montant_deductible,  # négatif = charge
            "categorie": "Blanchissage professionnel",
            "sous_categorie": "Forfait annuel",
            "type_operation": "OD",
            "lettre": True,
            "justificatif": True,
            "commentaire": f"{doublon_marker} — {result.reference_legale}",
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

        # 5. Enregistrer dans la GED
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
        Cherche le fichier opérations de décembre pour l'année donnée.
        Patterns possibles : operations_YYYYMM.json, operations_{year}12.json
        Si inexistant, crée un fichier vide.
        """
        # Chercher les patterns existants
        for pattern in [f"operations_{year}12.json", f"operations_{year}-12.json"]:
            if (OPERATIONS_DIR / pattern).exists():
                return pattern

        # Chercher par metadata dans les fichiers existants
        for f in OPERATIONS_DIR.glob("operations_*.json"):
            try:
                ops = json.loads(f.read_text(encoding="utf-8"))
                if ops and isinstance(ops, list):
                    # Vérifier les metadata ou les dates
                    first_date = ops[0].get("date", "")
                    if first_date.startswith(f"{year}-12"):
                        return f.name
            except (json.JSONDecodeError, IndexError, KeyError):
                continue

        # Créer un nouveau fichier
        new_name = f"operations_{year}12.json"
        (OPERATIONS_DIR / new_name).write_text("[]", encoding="utf-8")
        return new_name

    def _generer_pdf_blanchissage(self, result: ForfaitResult) -> str:
        """
        PDF ReportLab A4 portrait :
        - Logo NeuronXcompta (backend/assets/logo_lockup_light.png)
        - Titre : "Frais de blanchissage professionnel"
        - Sous-titre : "Exercice {year} — Lavage à domicile" ou "Pressing professionnel"
        - Tableau : Article | Tarif réf. | Décote | Montant | Qté/j | Jours | Sous-total
        - Ligne total en gras
        - Pied de page :
          - "Jours travaillés : {N} jours (saisie manuelle)"
          - "Réf. {reference_legale} — Décote 30% pour lavage à domicile" (si domicile)
          - "Document généré le {date} — NeuronXcompta"
        - Footer : "Page 1/1"

        Convention de nommage : reconstitue_blanchissage_YYYYMMDD_MONTANT.pdf
        Montant formaté avec virgule : 2582,10

        Le fichier est écrit dans data/justificatifs/en_attente/ (comme les autres reconstitués).
        Retourne le nom du fichier (pas le chemin complet).

        Utiliser le même style ReportLab que les autres PDF de l'app :
        - from reportlab.lib.pagesizes import A4
        - from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        - from reportlab.lib.styles import getSampleStyleSheet
        - from reportlab.lib import colors
        - Logo en haut à gauche si le fichier existe
        """
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
        from reportlab.lib.units import mm

        # Nom du fichier
        montant_str = f"{result.montant_deductible:.2f}".replace(".", ",")
        date_str = f"{result.year}1231"
        filename = f"reconstitue_blanchissage_{date_str}_{montant_str}.pdf"

        output_dir = DATA_DIR / "justificatifs" / "en_attente"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / filename

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
        logo_path = Path("backend/assets/logo_lockup_light.png")
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
        elements.append(Spacer(1, 8 * mm))

        # Tableau
        def fmt_eur(val: float) -> str:
            return f"{val:,.2f} €".replace(",", " ").replace(".", ",").replace(" ", " ")

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

        # Pied
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
        return filename

    def _register_ged(self, pdf_filename: str, result: ForfaitResult, op_file: str, op_index: int) -> str:
        """
        Enregistrer le PDF dans la GED via ged_service.
        Metadata :
        - categorie : "Blanchissage professionnel"
        - type : "justificatif"
        - year / month : result.year / 12
        - source : "reconstitue"
        - operation_file : op_file
        - operation_index : op_index

        Retourne le doc_id GED.

        Utiliser le pattern existant : importer ged_service et appeler
        ged_service.register_document() ou la méthode équivalente.
        """
        # Importer et utiliser le ged_service existant
        from backend.services.ged_service import GedService
        ged = GedService()

        src_path = DATA_DIR / "justificatifs" / "en_attente" / pdf_filename
        doc_id = ged.register_document(
            filepath=str(src_path),
            metadata={
                "categorie": "Blanchissage professionnel",
                "type": "justificatif",
                "year": result.year,
                "month": 12,
                "source": "reconstitue",
                "fournisseur": "Blanchissage",
                "montant": result.montant_deductible,
                "operation_file": op_file,
                "operation_index": op_index,
            },
        )
        return doc_id

    # ── Lecture forfaits existants ──

    def get_forfaits_generes(self, year: int) -> list[dict]:
        """
        Scanner les fichiers d'opérations de l'année pour trouver les OD forfaitaires.
        Identifier par : type_operation == "OD" ET commentaire contenant "Charge forfaitaire blanchissage".
        Retourne une liste de dicts : { type_forfait, montant, date_ecriture, od_filename, od_index }
        """
        results = []
        marker = f"Charge forfaitaire blanchissage {year}"

        for f in sorted(OPERATIONS_DIR.glob("operations_*.json")):
            try:
                ops = json.loads(f.read_text(encoding="utf-8"))
                for i, op in enumerate(ops):
                    comment = op.get("commentaire", "")
                    if comment.startswith(marker) and op.get("type_operation") == "OD":
                        results.append({
                            "type_forfait": "blanchissage",
                            "montant": abs(op.get("montant", 0)),
                            "date_ecriture": op.get("date", ""),
                            "od_filename": f.name,
                            "od_index": i,
                        })
            except (json.JSONDecodeError, KeyError):
                continue

        return results

    # ── Suppression ──

    def supprimer_forfait(self, type_forfait: str, year: int) -> bool:
        """
        1. Trouver l'OD via get_forfaits_generes
        2. Supprimer l'opération du fichier JSON
        3. Supprimer le PDF de data/justificatifs/en_attente/ (pattern reconstitue_blanchissage_{year}*)
        4. Supprimer l'entrée GED correspondante
        Retourne True si supprimé, False si non trouvé.
        """
        generes = self.get_forfaits_generes(year)
        if not generes:
            return False

        for g in generes:
            # Supprimer l'opération
            filepath = OPERATIONS_DIR / g["od_filename"]
            ops = json.loads(filepath.read_text(encoding="utf-8"))
            if g["od_index"] < len(ops):
                ops.pop(g["od_index"])
                filepath.write_text(
                    json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8"
                )

            # Supprimer le PDF
            justif_dir = DATA_DIR / "justificatifs" / "en_attente"
            for pdf in justif_dir.glob(f"reconstitue_blanchissage_{year}*"):
                pdf.unlink(missing_ok=True)

            # Supprimer de la GED
            # Importer ged_service et supprimer par filename pattern
            from backend.services.ged_service import GedService
            ged = GedService()
            # Chercher et supprimer le document GED correspondant
            # (adapter selon l'API exacte de ged_service)

        return True
```

---

## Étape 4 — Backend Router

### Créer `backend/routers/charges_forfaitaires.py`

```python
from fastapi import APIRouter, HTTPException

from backend.models.charges_forfaitaires import (
    BlanchissageRequest, ForfaitResult, GenerateODRequest, GenerateODResponse,
)
from backend.services.charges_forfaitaires_service import ChargesForfaitairesService

router = APIRouter(prefix="/api/charges-forfaitaires", tags=["charges-forfaitaires"])
service = ChargesForfaitairesService()


@router.post("/calculer/blanchissage", response_model=ForfaitResult)
async def calculer_blanchissage(request: BlanchissageRequest):
    """Calcule le montant déductible sans générer d'OD."""
    try:
        return service.calculer_blanchissage(request)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/generer", response_model=GenerateODResponse)
async def generer_od(request: GenerateODRequest):
    """Génère l'OD + PDF reconstitué + enregistrement GED."""
    try:
        return service.generer_od(request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/generes")
async def get_forfaits_generes(year: int):
    """Liste les forfaits déjà générés pour l'année."""
    return service.get_forfaits_generes(year)


@router.delete("/supprimer/{type_forfait}")
async def supprimer_forfait(type_forfait: str, year: int):
    """Supprime l'OD + PDF + entrée GED pour pouvoir regénérer."""
    ok = service.supprimer_forfait(type_forfait, year)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Aucun forfait {type_forfait} trouvé pour {year}")
    return {"deleted": True}
```

### Enregistrer dans `main.py`

```python
from backend.routers.charges_forfaitaires import router as charges_forfaitaires_router
app.include_router(charges_forfaitaires_router)
```

---

## Étape 5 — Frontend Types

### Ajouter dans `frontend/src/types/index.ts`

```typescript
// --- Charges Forfaitaires ---

export type TypeForfait = 'blanchissage' | 'vehicule';
export type ModeBlanchissage = 'domicile' | 'pressing';

export interface ArticleBlanchissage {
  type: string;
  tarif_pressing: number;
  quantite_jour: number;
}

export interface BaremeBlanchissage {
  annee: number;
  reference_legale: string;
  mode_defaut: string;
  decote_domicile: number;
  articles: ArticleBlanchissage[];
}

export interface ArticleDetail {
  type: string;
  tarif_pressing: number;
  montant_unitaire: number;
  quantite_jour: number;
  jours: number;
  sous_total: number;
}

export interface ForfaitResult {
  type_forfait: TypeForfait;
  year: number;
  montant_total: number;
  montant_deductible: number;
  detail: ArticleDetail[];
  reference_legale: string;
  mode: string;
  decote: number;
  jours_travailles: number;
  cout_jour: number;
}

export interface GenerateODRequest {
  type_forfait: TypeForfait;
  year: int;
  jours_travailles: number;
  mode: ModeBlanchissage;
  date_ecriture?: string;
}

export interface GenerateODResponse {
  od_filename: string;
  od_index: number;
  pdf_filename: string;
  ged_doc_id: string;
  montant: number;
}

export interface ForfaitGenere {
  type_forfait: TypeForfait;
  montant: number;
  date_ecriture: string;
  od_filename: string;
  od_index: number;
}
```

---

## Étape 6 — Frontend Hooks

### Créer `frontend/src/hooks/useChargesForfaitaires.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import type {
  BlanchissageRequest, ForfaitResult, GenerateODRequest,
  GenerateODResponse, ForfaitGenere, BaremeBlanchissage,
} from '../types';

// Barème blanchissage (via endpoint simulation barèmes existant)
export function useBaremeBlanchissage(year: number) {
  return useQuery<BaremeBlanchissage>({
    queryKey: ['bareme', 'blanchissage', year],
    queryFn: () => api.get(`/api/simulation/baremes/blanchissage?year=${year}`),
  });
}

// Calcul blanchissage (mutation car prend des paramètres)
export function useCalculerBlanchissage() {
  return useMutation<ForfaitResult, Error, { year: number; jours_travailles: number; mode: string }>({
    mutationFn: (data) => api.post('/api/charges-forfaitaires/calculer/blanchissage', data),
  });
}

// Génération OD + PDF + GED
export function useGenererOD() {
  const qc = useQueryClient();
  return useMutation<GenerateODResponse, Error, GenerateODRequest>({
    mutationFn: (data) => api.post('/api/charges-forfaitaires/generer', data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] });
      qc.invalidateQueries({ queryKey: ['operations'] });
      qc.invalidateQueries({ queryKey: ['ged'] });
    },
  });
}

// Forfaits déjà générés pour l'année
export function useForfaitsGeneres(year: number) {
  return useQuery<ForfaitGenere[]>({
    queryKey: ['forfaits-generes', year],
    queryFn: () => api.get(`/api/charges-forfaitaires/generes?year=${year}`),
  });
}

// Suppression forfait
export function useSupprimerForfait() {
  const qc = useQueryClient();
  return useMutation<{ deleted: boolean }, Error, { type_forfait: string; year: number }>({
    mutationFn: ({ type_forfait, year }) =>
      api.delete(`/api/charges-forfaitaires/supprimer/${type_forfait}?year=${year}`),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] });
      qc.invalidateQueries({ queryKey: ['operations'] });
      qc.invalidateQueries({ queryKey: ['ged'] });
    },
  });
}
```

---

## Étape 7 — Frontend Page

### Créer `frontend/src/components/charges-forfaitaires/ChargesForfaitairesPage.tsx`

La page suit le pattern des autres pages CLÔTURE (AmortissementsPage) :

**Header :**
- Titre "Charges forfaitaires" avec icône `Receipt` (lucide-react)
- Année depuis `useFiscalYearStore`
- Tabs : seul onglet "Blanchissage" pour l'instant (structure prête pour "Véhicule")

**Contenu onglet Blanchissage — deux états :**

#### État 1 : Pas encore généré (`useForfaitsGeneres` retourne vide pour blanchissage)

```
┌──────────────────────────────────────────────────────┐
│  Frais de blanchissage — Exercice 2025    ⚙ Barème  │
│                                                      │
│  Jours travaillés   [ 230 ]                         │
│                                                      │
│  ┌─────────────────────┐ ┌─────────────────────────┐│
│  │ Coût/jour (décote)  │ │ Total déductible        ││
│  │ 11,90 €             │ │ 2 737,00 €              ││
│  └─────────────────────┘ └─────────────────────────┘│
│                                                      │
│                         [ Générer l'écriture ]       │
└──────────────────────────────────────────────────────┘
```

- Le champ `jours_travailles` est un `<input type="number">`, valeur par défaut 230
- À chaque changement de valeur (debounce 300ms), appeler `useCalculerBlanchissage` pour recalculer les MetricCards en temps réel
- Lien "⚙ Barème" toggle l'affichage du tableau barème (articles, tarifs, décote) — lecture seule, modifiable via `PUT /api/simulation/baremes/blanchissage`
- Bouton "Générer l'écriture" appelle `useGenererOD` puis affiche l'état 2

#### État 2 : Déjà généré

```
┌──────────────────────────────────────────────────────┐
│  ✓ OD créée    ✓ PDF généré    ✓ GED enregistré     │
│                                                      │
│  [PDF] reconstitue_blanchissage_20251231_2737,00.pdf │
│        Blanchissage professionnel · 31/12/2025       │
│                                                      │
│  Montant déductible : 2 737,00 €                    │
│                                                      │
│            [ Ouvrir dans la GED ]  [ Regénérer ]     │
└──────────────────────────────────────────────────────┘
```

- Checklist de confirmation (3 lignes avec ✓ vert)
- Bloc fichier PDF avec icône rouge PDF, nom du fichier, metadata
- Bouton "Ouvrir dans la GED" → `navigate('/ged?search=reconstitue_blanchissage')`
- Bouton "Regénérer" → dialog confirmation → `useSupprimerForfait` puis retour état 1

**Comportement :**
- Au montage, `useForfaitsGeneres(year)` détermine quel état afficher
- Quand l'année change (store Zustand), tout se recharge
- Toast `react-hot-toast` sur succès génération ("Écriture blanchissage générée — 2 737,00 €")
- Toast erreur si doublon (HTTP 409)

---

## Étape 8 — Intégration Simulation BNC

### Modifier la page Simulation (`SimulationPage.tsx`)

Dans la section leviers/charges, ajouter une sous-section **"Charges forfaitaires"** :

```tsx
// Utiliser useForfaitsGeneres(year) pour récupérer les forfaits actifs
const { data: forfaits } = useForfaitsGeneres(year);

// State local pour les toggles (tous cochés par défaut)
const [forfaitExclus, setForfaitExclus] = useState<Record<string, boolean>>({});

// Dans le rendu, après les charges existantes et avant amortissements :
<div className="text-xs font-medium text-secondary mb-2 mt-4">Charges forfaitaires</div>

{forfaits?.map(f => (
  <div key={f.type_forfait} className="flex items-center gap-3 py-1">
    <input
      type="checkbox"
      checked={!forfaitExclus[f.type_forfait]}
      onChange={() => setForfaitExclus(prev => ({
        ...prev,
        [f.type_forfait]: !prev[f.type_forfait]
      }))}
      className="rounded"
    />
    <span className="text-sm">
      {f.type_forfait === 'blanchissage' ? 'Blanchissage professionnel' : f.type_forfait}
    </span>
    <span className="ml-auto text-sm font-medium">
      -{formatCurrency(f.montant)}
    </span>
  </div>
))}

{/* Types de forfaits pas encore générés */}
{!forfaits?.find(f => f.type_forfait === 'blanchissage') && (
  <div className="flex items-center gap-3 py-1 opacity-40">
    <input type="checkbox" disabled className="rounded" />
    <span className="text-sm">Blanchissage professionnel</span>
    <Link to="/charges-forfaitaires" className="ml-auto text-xs text-info hover:underline">
      Configurer →
    </Link>
  </div>
)}
```

### Logique de calcul

Les OD forfaitaires sont déjà incluses dans le BNC calculé depuis les opérations (via `GET /api/simulation/historique`). Les checkboxes permettent d'**exclure** un forfait pour voir l'impact :

```typescript
// Dans le calcul du BNC simulé
let bnc_ajuste = bnc_actuel;

// Si un forfait est exclu (checkbox décochée), réintégrer son montant
for (const f of forfaits) {
  if (forfaitExclus[f.type_forfait]) {
    bnc_ajuste += f.montant; // réintégrer la charge exclue
  }
}
```

---

## Étape 9 — Sidebar

### Modifier `frontend/src/components/layout/Sidebar.tsx`

Ajouter dans le groupe CLÔTURE, après l'entrée Amortissements :

```typescript
{
  path: '/charges-forfaitaires',
  label: 'Charges forfaitaires',
  icon: Receipt,  // import { Receipt } from 'lucide-react'
}
```

Dans le tableau `navGroups`, groupe CLÔTURE :
```typescript
{
  label: 'CLÔTURE',
  items: [
    { path: '/exports', label: 'Export Comptable', icon: Download },
    { path: '/cloture', label: 'Clôture', icon: Lock },
    { path: '/amortissements', label: 'Amortissements', icon: TrendingDown },
    { path: '/charges-forfaitaires', label: 'Charges forfaitaires', icon: Receipt },  // NEW
  ],
}
```

---

## Étape 10 — Route

### Modifier `frontend/src/App.tsx`

Ajouter après la route `/amortissements` :

```tsx
import ChargesForfaitairesPage from './components/charges-forfaitaires/ChargesForfaitairesPage';

// Dans les routes :
<Route path="/charges-forfaitaires" element={<ChargesForfaitairesPage />} />
```

---

## Étape 11 — Catégorie

S'assurer que la catégorie `Blanchissage professionnel` existe dans `data/categories.json` avec la sous-catégorie `Forfait annuel`.

Si elle n'existe pas, l'ajouter manuellement ou au boot du service :

```json
{
  "name": "Blanchissage professionnel",
  "subcategories": ["Forfait annuel"],
  "type": "depense",
  "deductible": true
}
```

---

## Vérification

- [ ] `data/baremes/blanchissage_2025.json` créé avec les bons articles et tarifs
- [ ] `GET /api/simulation/baremes/blanchissage?year=2025` retourne le barème
- [ ] `POST /api/charges-forfaitaires/calculer/blanchissage` avec `{year: 2025, jours_travailles: 230, mode: "domicile"}` retourne `montant_deductible = 2737.00` (230 × (7×0.7×1 + 8×0.7×1 + 2×0.7×2) = 230 × 11.90)
- [ ] `POST /api/charges-forfaitaires/generer` crée l'OD dans le fichier opérations de décembre
- [ ] L'OD a `type_operation: "OD"`, `categorie: "Blanchissage professionnel"`, montant négatif
- [ ] Le PDF est nommé `reconstitue_blanchissage_20251231_2737,00.pdf`
- [ ] Le PDF contient le tableau détaillé, la référence légale, le nombre de jours
- [ ] Le PDF est enregistré dans la GED avec les metadata correctes
- [ ] `GET /api/charges-forfaitaires/generes?year=2025` détecte le forfait existant
- [ ] Doublon protégé : re-générer retourne HTTP 409
- [ ] `DELETE /api/charges-forfaitaires/supprimer/blanchissage?year=2025` supprime OD + PDF + GED
- [ ] Page frontend : calcul live fonctionne au changement de jours
- [ ] Page frontend : état "déjà généré" affiché si forfait existe
- [ ] Page frontend : bouton "Regénérer" supprime puis revient à l'état saisie
- [ ] Simulation BNC : checkbox blanchissage visible et cochée si forfait généré
- [ ] Simulation BNC : décocher réintègre le montant dans le BNC affiché
- [ ] Simulation BNC : lien "Configurer →" si forfait non généré
- [ ] Sidebar : entrée "Charges forfaitaires" avec icône Receipt dans groupe CLÔTURE
- [ ] Route `/charges-forfaitaires` fonctionnelle
- [ ] Catégorie "Blanchissage professionnel" existe
- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] Toast react-hot-toast sur succès et erreur
