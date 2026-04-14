# Prompt : Charges Forfaitaires — Onglet Véhicule (Quote-part professionnelle)

## Contexte

Ajout du deuxième onglet **Véhicule** dans la page `/charges-forfaitaires` existante (premier onglet Blanchissage déjà implémenté). Cet onglet calcule la **quote-part professionnelle** du véhicule à partir des kilomètres réels, met à jour le `deductible_pct` du poste comptable GED "véhicule", et génère un PDF rapport récapitulatif pour traçabilité fiscale.

**Différence fondamentale avec le blanchissage :**
- Blanchissage → calcule un montant → génère une OD (écriture comptable) dans les opérations
- Véhicule → calcule un **ratio %** → met à jour le poste comptable GED → génère un PDF rapport (pas d'OD)

Le ratio détermine le % de déductibilité appliqué à **toutes** les opérations catégorisées "Véhicule" (carburant, assurance, entretien, etc.) dans les calculs BNC, rapports et exports.

**Formule :**
```
km_trajet_habituel = jours_travaillés × distance_domicile_clinique × 2
km_pro_total = km_trajet_habituel + km_supplementaires
ratio_pro = (km_pro_total / km_totaux_compteur) × 100
```

**Patterns à respecter (alignement blanchissage implémenté) :**
- PDF stocké dans `data/reports/` (pas `justificatifs/`)
- GED enregistré comme `type: "rapport"` avec `rapport_meta` et `source_module: "charges-forfaitaires"`
- Config persistée dans `data/charges_forfaitaires_config.json` (dict clé=année) via `GET/PUT /api/charges-forfaitaires/config`
- Frontend : réutiliser `useChargesForfaitairesConfig(year)` + `useUpdateChargesForfaitairesConfig()` existants
- Gate `configReady` avant calcul live (évite flash valeurs par défaut)
- Toast custom brandé (logo + gradient violet) à la génération
- Aperçu PDF compact (280px) / agrandi (700px) avec toggle Maximize2/Minimize2
- Bouton "Envoyer au comptable" via `sendDrawerStore.open({ defaultSubject })`
- Navigation bidirectionnelle GED ↔ page via `source_module === 'charges-forfaitaires'`

---

## Étape 1 — Config persistée

### Étendre `data/charges_forfaitaires_config.json`

Ce fichier existe déjà (créé par le blanchissage). C'est un dict clé=année. Ajouter les champs véhicule dans la même structure :

```json
{
  "2025": {
    "jours_travailles": 176.5,
    "honoraires_liasse": 300000,
    "vehicule_distance_km": 18,
    "vehicule_km_supplementaires": 1200,
    "vehicule_km_totaux_compteur": 14000
  }
}
```

Les champs `vehicule_*` sont ajoutés au même objet année que `jours_travailles` et `honoraires_liasse`. Le champ `jours_travailles` est **partagé** entre blanchissage et véhicule (même donnée fiscale).

### Étendre le endpoint `PUT /api/charges-forfaitaires/config`

Le endpoint accepte déjà un body partiel. Il suffit que le backend accepte les nouveaux champs sans casser les existants. Pas de nouveau endpoint nécessaire.

---

## Étape 2 — Barème véhicule (historique uniquement)

### Créer `data/baremes/vehicule_2025.json`

Ce fichier stocke l'**historique des applications** (traçabilité), pas les inputs courants (qui sont dans la config).

```json
{
  "annee": 2025,
  "date_derniere_application": null,
  "ratio_pro_applique": null,
  "historique": []
}
```

Le champ `historique` conserve chaque application :
```json
{
  "historique": [
    {
      "date": "2025-12-31T14:30:00",
      "ratio": 67.7,
      "ancien_ratio": 70.0,
      "distance": 18,
      "jours": 176.5,
      "km_sup": 1200,
      "km_totaux": 14000,
      "pdf_filename": "quote_part_vehicule_2025.pdf",
      "ged_doc_id": "data/reports/quote_part_vehicule_2025.pdf"
    }
  ]
}
```

### Chargement barème

Ajouter le type `vehicule` dans le chargeur de barèmes existant (même logique que `blanchissage`) :
- `GET /api/simulation/baremes/vehicule?year=2025` → retourne le barème
- `PUT /api/simulation/baremes/vehicule?year=2025` → sauvegarde
- Fallback : si `vehicule_2025.json` n'existe pas, charger l'année la plus récente ; si aucun fichier, retourner un barème vide avec valeurs par défaut

---

## Étape 3 — Backend Models

### Ajouter dans `backend/models/charges_forfaitaires.py`

```python
class VehiculeRequest(BaseModel):
    year: int
    distance_domicile_clinique_km: float
    jours_travailles: float  # décimales comme blanchissage (step 0.5)
    km_supplementaires: float = 0
    km_totaux_compteur: float

    @field_validator("km_totaux_compteur")
    @classmethod
    def km_totaux_positif(cls, v):
        if v <= 0:
            raise ValueError("km_totaux_compteur doit être > 0")
        return v


class VehiculeResult(BaseModel):
    type_forfait: TypeForfait = TypeForfait.VEHICULE
    year: int
    distance_domicile_clinique_km: float
    jours_travailles: float
    km_trajet_habituel: float      # jours × distance × 2
    km_supplementaires: float
    km_pro_total: float            # trajet + supplémentaires
    km_totaux_compteur: float
    ratio_pro: float               # 0-100, arrondi 1 décimale
    ratio_perso: float             # 100 - ratio_pro
    ancien_ratio: float | None     # ratio actuel du poste GED (pour afficher le delta)
    delta_ratio: float | None      # ratio_pro - ancien_ratio


class ApplyVehiculeRequest(BaseModel):
    year: int
    distance_domicile_clinique_km: float
    jours_travailles: float
    km_supplementaires: float = 0
    km_totaux_compteur: float


class ApplyVehiculeResponse(BaseModel):
    ratio_pro: float
    ancien_ratio: float
    pdf_filename: str
    ged_doc_id: str
    poste_updated: bool
```

---

## Étape 4 — Backend Service

### Ajouter les méthodes véhicule dans `backend/services/charges_forfaitaires_service.py`

La classe `ChargesForfaitairesService` existe déjà. Ajouter les méthodes suivantes.

```python
# ── Véhicule : chargement barème ──

def _load_bareme_vehicule(self, year: int) -> dict:
    """
    Charge baremes/vehicule_{year}.json.
    Fallback : année la plus récente disponible.
    Si aucun fichier, retourne un dict par défaut.
    """
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

def _save_bareme_vehicule(self, year: int, data: dict):
    """Sauvegarde le barème véhicule."""
    target = BAREMES_DIR / f"vehicule_{year}.json"
    BAREMES_DIR.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

# ── Véhicule : calcul ──

def calculer_vehicule(self, request: VehiculeRequest) -> VehiculeResult:
    """
    Calcule le ratio pro sans rien persister.
    Lit le poste GED actuel pour calculer le delta.
    """
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
    5. Enregistrer dans la GED comme type "rapport" avec source_module
    6. Mettre à jour l'historique dans le barème véhicule
    """
    # 1. Calcul
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
    config = self._load_config()
    year_key = str(request.year)
    if year_key not in config:
        config[year_key] = {}
    config[year_key]["vehicule_distance_km"] = request.distance_domicile_clinique_km
    config[year_key]["vehicule_km_supplementaires"] = request.km_supplementaires
    config[year_key]["vehicule_km_totaux_compteur"] = request.km_totaux_compteur
    # jours_travailles est partagé avec blanchissage dans la même config
    config[year_key]["jours_travailles"] = request.jours_travailles
    self._save_config(config)

    # 4. Générer le PDF dans data/reports/
    pdf_filename = self._generer_pdf_vehicule(result)

    # 5. Enregistrer dans la GED comme rapport
    ged_doc_id = self._register_ged_vehicule(pdf_filename, result)

    # 6. Historique dans le barème
    bareme = self._load_bareme_vehicule(request.year)
    bareme["date_derniere_application"] = datetime.now().isoformat()
    bareme["ratio_pro_applique"] = result.ratio_pro
    if "historique" not in bareme:
        bareme["historique"] = []
    bareme["historique"].append({
        "date": datetime.now().isoformat(),
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

    return ApplyVehiculeResponse(
        ratio_pro=result.ratio_pro,
        ancien_ratio=ancien_ratio,
        pdf_filename=pdf_filename,
        ged_doc_id=ged_doc_id,
        poste_updated=poste_updated,
    )

# ── Helpers internes ──

def _get_current_vehicule_pct(self) -> float | None:
    """
    Lit le deductible_pct actuel du poste 'vehicule' dans data/ged/ged_postes.json.
    Retourne None si le poste n'existe pas.
    """
    postes_file = DATA_DIR / "ged" / "ged_postes.json"
    if not postes_file.exists():
        return None
    data = json.loads(postes_file.read_text(encoding="utf-8"))
    postes = data.get("postes", [])
    for p in postes:
        if p.get("id") == "vehicule":
            return p.get("deductible_pct")
    return None

def _update_vehicule_poste_pct(self, new_pct: float) -> bool:
    """
    Met à jour le deductible_pct du poste 'vehicule' dans ged_postes.json.
    Valeur exacte calculée (pas arrondie au step 5 du slider).
    Retourne True si mis à jour, False si poste non trouvé.
    """
    postes_file = DATA_DIR / "ged" / "ged_postes.json"
    if not postes_file.exists():
        return False
    data = json.loads(postes_file.read_text(encoding="utf-8"))
    postes = data.get("postes", [])
    for p in postes:
        if p.get("id") == "vehicule":
            p["deductible_pct"] = round(new_pct, 1)
            postes_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return True
    return False

def _generer_pdf_vehicule(self, result: VehiculeResult) -> str:
    """
    PDF ReportLab A4 portrait — récapitulatif quote-part véhicule.
    Stocké dans data/reports/ (même pattern que blanchissage).

    Contenu :
    - Logo NeuronXcompta (backend/assets/logo_lockup_light.png)
    - Titre : "Quote-part professionnelle véhicule"
    - Sous-titre : "Exercice {year}"
    - Section "Paramètres de calcul" (tableau) :
        - Distance domicile → clinique : {N} km (aller simple)
        - Jours travaillés : {N}
        - Km supplémentaires (gardes, formations) : {N}
        - Km totaux compteur (relevé annuel) : {N}
    - Section "Résultat" (tableau, ligne ratio pro sur fond vert clair) :
        - Km trajet habituel : {N} ({jours} × {distance} × 2)
        - Km professionnels total : {N}
        - **Quote-part professionnelle : {ratio}%**
        - Quote-part personnelle : {100-ratio}%
    - Section "Application" :
        - "Le taux de {ratio}% est appliqué au poste comptable Véhicule."
        - "Toutes les dépenses catégorisées Véhicule sont déductibles à {ratio}%."
        - Ancien taux → Nouveau taux (delta ±N pts) si applicable
    - Pied de page :
        - "Méthode : frais réels au prorata kilométrique"
        - "Document généré le {date} — NeuronXcompta"
    - Footer : "Page 1/1"

    Convention de nommage : quote_part_vehicule_{year}.pdf
    Même style ReportLab que _generer_pdf_blanchissage (logo, A4, mêmes styles/polices/couleurs).
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    filename = f"quote_part_vehicule_{result.year}.pdf"

    # Stocké dans data/reports/ comme le blanchissage
    output_dir = DATA_DIR / "reports"
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
    elements.append(Paragraph("Quote-part professionnelle véhicule", title_style))

    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontSize=11, textColor=colors.grey
    )
    elements.append(Paragraph(f"Exercice {result.year}", subtitle_style))
    elements.append(Spacer(1, 8 * mm))

    # Section paramètres
    section_style = ParagraphStyle(
        "Section", parent=styles["Heading2"], fontSize=12, spaceAfter=3 * mm,
        textColor=colors.HexColor("#336699")
    )
    elements.append(Paragraph("Paramètres de calcul", section_style))

    def fmt_km(val: float) -> str:
        return f"{val:,.1f} km".replace(",", " ").replace(".", ",")

    params_data = [
        ["Distance domicile → clinique", f"{result.distance_domicile_clinique_km:g} km (aller simple)"],
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
    elements.append(Spacer(1, 6 * mm))

    # Section résultat
    elements.append(Paragraph("Résultat", section_style))

    formule = f"{result.jours_travailles:g} × {result.distance_domicile_clinique_km:g} × 2"
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
        ("BOLD", (0, 2), (-1, 2), True),
        ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#f0f7f0")),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.grey),
    ]))
    elements.append(result_table)
    elements.append(Spacer(1, 6 * mm))

    # Section application
    elements.append(Paragraph("Application", section_style))
    note_style = ParagraphStyle(
        "Note", parent=styles["Normal"], fontSize=9, leading=13
    )
    elements.append(Paragraph(
        f"Le taux de <b>{result.ratio_pro:g}%</b> est appliqué au poste comptable Véhicule.",
        note_style,
    ))
    elements.append(Paragraph(
        "Toutes les dépenses catégorisées Véhicule sont déductibles à ce taux.",
        note_style,
    ))
    if result.ancien_ratio is not None:
        delta_sign = "+" if result.delta_ratio >= 0 else ""
        elements.append(Paragraph(
            f"Ancien taux : {result.ancien_ratio:g}% → Nouveau taux : {result.ratio_pro:g}% "
            f"(delta : {delta_sign}{result.delta_ratio:g} pts)",
            note_style,
        ))
    elements.append(Spacer(1, 10 * mm))

    # Pied
    footer_style = ParagraphStyle(
        "Footer", parent=styles["Normal"], fontSize=8, textColor=colors.grey
    )
    elements.append(Paragraph(
        "Méthode : frais réels au prorata kilométrique", footer_style
    ))
    now_str = datetime.now().strftime("%d/%m/%Y")
    elements.append(Paragraph(
        f"Document généré le {now_str} — NeuronXcompta", footer_style
    ))

    doc.build(elements)
    return filename

def _register_ged_vehicule(self, pdf_filename: str, result: VehiculeResult) -> str:
    """
    Enregistrer le PDF véhicule dans la GED.
    Même pattern que blanchissage : type "rapport", source_module, rapport_meta.

    Utiliser register_rapport() ou register_document avec metadata rapport
    (même méthode que le blanchissage) :
    - type : "rapport"
    - source_module : "charges-forfaitaires"
    - rapport_meta : title, description, generated_at
    - year / month : result.year / 12
    - categorie : "Véhicule"
    """
    from backend.services.ged_service import GedService
    ged = GedService()

    src_path = DATA_DIR / "reports" / pdf_filename
    doc_id = ged.register_document(
        filepath=str(src_path),
        metadata={
            "type": "rapport",
            "categorie": "Véhicule",
            "year": result.year,
            "month": 12,
            "source_module": "charges-forfaitaires",
            "rapport_meta": {
                "title": f"Quote-part véhicule {result.year}",
                "description": (
                    f"Quote-part professionnelle {result.ratio_pro:g}% — "
                    f"{result.jours_travailles:g}j × {result.distance_domicile_clinique_km:g}km"
                ),
                "generated_at": datetime.now().isoformat(),
            },
        },
    )
    return doc_id

# ── Véhicule : détection forfait existant ──

def get_vehicule_genere(self, year: int) -> dict | None:
    """
    Vérifie si la quote-part véhicule a été appliquée pour l'année.
    Retourne les infos si appliqué (incluant pdf_filename et ged_doc_id
    pour le preview et la navigation GED), None sinon.
    """
    bareme = self._load_bareme_vehicule(year)
    if bareme.get("date_derniere_application"):
        pdf_filename = f"quote_part_vehicule_{year}.pdf"
        ged_doc_id = f"data/reports/{pdf_filename}"
        return {
            "type_forfait": "vehicule",
            "ratio_pro": bareme.get("ratio_pro_applique"),
            "date_application": bareme.get("date_derniere_application"),
            "pdf_filename": pdf_filename,
            "ged_doc_id": ged_doc_id,
            "distance": bareme["historique"][-1]["distance"] if bareme.get("historique") else None,
            "jours": bareme["historique"][-1]["jours"] if bareme.get("historique") else None,
            "km_sup": bareme["historique"][-1]["km_sup"] if bareme.get("historique") else None,
            "km_totaux": bareme["historique"][-1]["km_totaux"] if bareme.get("historique") else None,
        }
    return None

# ── Véhicule : suppression (regénération) ──

def supprimer_vehicule(self, year: int) -> bool:
    """
    1. Supprimer le PDF de data/reports/
    2. Supprimer l'entrée GED correspondante
    3. Réinitialiser date_derniere_application dans le barème (garder historique)
    4. NE PAS remettre le poste GED à l'ancienne valeur
    Retourne True si supprimé.
    """
    bareme = self._load_bareme_vehicule(year)
    if not bareme.get("date_derniere_application"):
        return False

    # Supprimer le PDF
    pdf_path = DATA_DIR / "reports" / f"quote_part_vehicule_{year}.pdf"
    if pdf_path.exists():
        pdf_path.unlink()

    # Supprimer de la GED
    from backend.services.ged_service import GedService
    ged = GedService()
    # Chercher et supprimer par doc_id = "data/reports/quote_part_vehicule_{year}.pdf"
    # (même pattern que supprimer_forfait blanchissage)

    # Réinitialiser le barème (garder l'historique pour traçabilité)
    bareme["date_derniere_application"] = None
    bareme["ratio_pro_applique"] = None
    self._save_bareme_vehicule(year, bareme)

    return True
```

---

## Étape 5 — Backend Router

### Ajouter les endpoints véhicule dans `backend/routers/charges_forfaitaires.py`

```python
from backend.models.charges_forfaitaires import (
    # ... imports existants blanchissage ...
    VehiculeRequest, VehiculeResult, ApplyVehiculeRequest, ApplyVehiculeResponse,
)


@router.post("/calculer/vehicule", response_model=VehiculeResult)
async def calculer_vehicule(request: VehiculeRequest):
    """Calcule le ratio pro sans persister. Retourne aussi le delta avec le poste actuel."""
    return service.calculer_vehicule(request)


@router.post("/appliquer/vehicule", response_model=ApplyVehiculeResponse)
async def appliquer_vehicule(request: ApplyVehiculeRequest):
    """Applique le ratio : met à jour le poste GED + génère PDF rapport + enregistre GED."""
    return service.appliquer_vehicule(request)


@router.get("/vehicule/genere")
async def get_vehicule_genere(year: int):
    """Vérifie si la quote-part véhicule a été appliquée pour l'année."""
    result = service.get_vehicule_genere(year)
    if result is None:
        return None
    return result


@router.delete("/supprimer/vehicule")
async def supprimer_vehicule(year: int):
    """Supprime le PDF rapport + entrée GED pour pouvoir regénérer."""
    ok = service.supprimer_vehicule(year)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Aucune quote-part véhicule trouvée pour {year}"
        )
    return {"deleted": True}
```

### Modifier `get_forfaits_generes` pour inclure le véhicule

L'endpoint existant `GET /generes?year=` doit aussi retourner le véhicule.

```python
@router.get("/generes")
async def get_forfaits_generes(year: int):
    """Liste les forfaits déjà générés pour l'année (blanchissage OD + véhicule ratio)."""
    results = service.get_forfaits_generes(year)  # blanchissage existant

    # Ajouter le véhicule si appliqué
    vehicule = service.get_vehicule_genere(year)
    if vehicule:
        results.append(vehicule)

    return results
```

---

## Étape 6 — Frontend Types

### Ajouter dans `frontend/src/types/index.ts`

```typescript
// --- Véhicule (quote-part pro) ---

export interface VehiculeRequest {
  year: number;
  distance_domicile_clinique_km: number;
  jours_travailles: number;  // float, step 0.5
  km_supplementaires: number;
  km_totaux_compteur: number;
}

export interface VehiculeResult {
  type_forfait: 'vehicule';
  year: number;
  distance_domicile_clinique_km: number;
  jours_travailles: number;
  km_trajet_habituel: number;
  km_supplementaires: number;
  km_pro_total: number;
  km_totaux_compteur: number;
  ratio_pro: number;
  ratio_perso: number;
  ancien_ratio: number | null;
  delta_ratio: number | null;
}

export interface ApplyVehiculeResponse {
  ratio_pro: number;
  ancien_ratio: number;
  pdf_filename: string;
  ged_doc_id: string;
  poste_updated: boolean;
}

export interface VehiculeGenere {
  type_forfait: 'vehicule';
  ratio_pro: number;
  date_application: string;
  pdf_filename: string;
  ged_doc_id: string;
  distance: number | null;
  jours: number | null;
  km_sup: number | null;
  km_totaux: number | null;
}
```

### Étendre `ChargesForfaitairesConfig`

Le type config existant doit inclure les champs véhicule :

```typescript
export interface ChargesForfaitairesConfig {
  jours_travailles?: number;      // partagé blanchissage + véhicule
  honoraires_liasse?: number;     // blanchissage
  vehicule_distance_km?: number;
  vehicule_km_supplementaires?: number;
  vehicule_km_totaux_compteur?: number;
}
```

---

## Étape 7 — Frontend Hooks

### Ajouter dans `frontend/src/hooks/useChargesForfaitaires.ts`

Les hooks config (`useChargesForfaitairesConfig`, `useUpdateChargesForfaitairesConfig`) existent déjà et sont réutilisés. Ajouter uniquement les hooks véhicule :

```typescript
import type {
  // ... imports existants ...
  VehiculeRequest, VehiculeResult, ApplyVehiculeResponse,
  VehiculeGenere,
} from '../types';

// Calcul véhicule (mutation car prend des paramètres)
export function useCalculerVehicule() {
  return useMutation<VehiculeResult, Error, VehiculeRequest>({
    mutationFn: (data) => api.post('/api/charges-forfaitaires/calculer/vehicule', data),
  });
}

// Application véhicule (poste GED + PDF + GED)
export function useAppliquerVehicule() {
  const qc = useQueryClient();
  return useMutation<ApplyVehiculeResponse, Error, VehiculeRequest>({
    mutationFn: (data) => api.post('/api/charges-forfaitaires/appliquer/vehicule', data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] });
      qc.invalidateQueries({ queryKey: ['charges-forfaitaires-config', variables.year] });
      qc.invalidateQueries({ queryKey: ['vehicule-genere', variables.year] });
      qc.invalidateQueries({ queryKey: ['ged'] });
      qc.invalidateQueries({ queryKey: ['ged-postes'] });
      qc.invalidateQueries({ queryKey: ['ged-stats'] });
    },
  });
}

// Véhicule déjà appliqué pour l'année
export function useVehiculeGenere(year: number) {
  return useQuery<VehiculeGenere | null>({
    queryKey: ['vehicule-genere', year],
    queryFn: () => api.get(`/api/charges-forfaitaires/vehicule/genere?year=${year}`),
  });
}

// Suppression véhicule (pour regénérer)
export function useSupprimerVehicule() {
  const qc = useQueryClient();
  return useMutation<{ deleted: boolean }, Error, { year: number }>({
    mutationFn: ({ year }) =>
      api.delete(`/api/charges-forfaitaires/supprimer/vehicule?year=${year}`),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] });
      qc.invalidateQueries({ queryKey: ['vehicule-genere', variables.year] });
      qc.invalidateQueries({ queryKey: ['charges-forfaitaires-config', variables.year] });
      qc.invalidateQueries({ queryKey: ['ged'] });
      qc.invalidateQueries({ queryKey: ['ged-postes'] });
    },
  });
}
```

---

## Étape 8 — Frontend Composant

### Créer `frontend/src/components/charges-forfaitaires/VehiculeTab.tsx`

**Props :** `{ year: number }`

**Imports :**
```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Info, Check, FileText, Maximize2, Minimize2, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useChargesForfaitairesConfig,
  useUpdateChargesForfaitairesConfig,
  useCalculerVehicule,
  useAppliquerVehicule,
  useVehiculeGenere,
  useSupprimerVehicule,
} from '../../hooks/useChargesForfaitaires';
import { useSendDrawerStore } from '../../stores/sendDrawerStore';
import { MetricCard } from '../common/MetricCard';
```

**State :**
```typescript
const [distance, setDistance] = useState(0);
const [jours, setJours] = useState(0);
const [kmSup, setKmSup] = useState(0);
const [kmTotaux, setKmTotaux] = useState(1);
const [configReady, setConfigReady] = useState(false);
const [showConfirmRegen, setShowConfirmRegen] = useState(false);
const [pdfExpanded, setPdfExpanded] = useState(false);

const navigate = useNavigate();
const openSendDrawer = useSendDrawerStore((s) => s.open);
```

**Initialisation depuis la config (gate configReady — même pattern que blanchissage) :**
```typescript
const { data: config, isSuccess: configLoaded } = useChargesForfaitairesConfig(year);
const updateConfig = useUpdateChargesForfaitairesConfig();
const { data: genere } = useVehiculeGenere(year);
const calculer = useCalculerVehicule();
const appliquer = useAppliquerVehicule();
const supprimer = useSupprimerVehicule();

useEffect(() => {
  if (configLoaded && config) {
    setDistance(config.vehicule_distance_km ?? 0);
    setJours(config.jours_travailles ?? 230);
    setKmSup(config.vehicule_km_supplementaires ?? 0);
    setKmTotaux(config.vehicule_km_totaux_compteur ?? 1);
    setConfigReady(true);
  } else if (configLoaded && !config) {
    setJours(230);
    setConfigReady(true);
  }
}, [configLoaded, config, year]);
```

**Calcul live (debounce 300ms, gated par configReady) :**
```typescript
useEffect(() => {
  if (!configReady || kmTotaux <= 0) return;
  const timer = setTimeout(() => {
    calculer.mutate({
      year,
      distance_domicile_clinique_km: distance,
      jours_travailles: jours,
      km_supplementaires: kmSup,
      km_totaux_compteur: kmTotaux,
    });
  }, 300);
  return () => clearTimeout(timer);
}, [distance, jours, kmSup, kmTotaux, year, configReady]);
```

**Persistence config au blur (même pattern que blanchissage) :**
```typescript
const handleBlur = () => {
  updateConfig.mutate({
    year,
    config: {
      vehicule_distance_km: distance,
      vehicule_km_supplementaires: kmSup,
      vehicule_km_totaux_compteur: kmTotaux,
      jours_travailles: jours,
    },
  });
};
```

**Actions :**
```typescript
const handleAppliquer = () => {
  appliquer.mutate(
    {
      year,
      distance_domicile_clinique_km: distance,
      jours_travailles: jours,
      km_supplementaires: kmSup,
      km_totaux_compteur: kmTotaux,
    },
    {
      onSuccess: (res) => {
        // Toast custom brandé — même pattern exact que blanchissage
        // (logo NeuronXcompta + gradient violet + texte)
        toast.custom((t) => (
          // ... copier le même composant toast que dans BlanchissageTab ...
          // Texte : "Quote-part véhicule appliquée — {res.ratio_pro}%"
        ));
      },
      onError: (err) => {
        toast.error(`Erreur : ${err.message}`);
      },
    }
  );
};

const handleRegenerer = () => {
  supprimer.mutate(
    { year },
    {
      onSuccess: () => {
        setShowConfirmRegen(false);
        toast.success('Quote-part supprimée — vous pouvez recalculer');
      },
    }
  );
};

const handleEnvoyerComptable = () => {
  openSendDrawer({
    defaultSubject: `Quote-part véhicule ${year} — ${genere?.ratio_pro}%`,
  });
};
```

**Rendu — État 1 : Pas encore appliqué (`genere` est null) :**

```
┌──────────────────────────────────────────────────────────────┐
│  Quote-part professionnelle véhicule                         │
│                                                              │
│  ┌───────────────────────────┐ ┌───────────────────────────┐│
│  │ Distance domicile →       │ │ Jours travaillés          ││
│  │ clinique (km)  [ 18  ]    │ │ [ 176.5 ]  (step 0.5)    ││
│  └───────────────────────────┘ └───────────────────────────┘│
│  ┌───────────────────────────┐ ┌───────────────────────────┐│
│  │ Km supplémentaires        │ │ Km totaux compteur        ││
│  │ (gardes, formations)      │ │ (relevé annuel)           ││
│  │ [ 1200 ]                  │ │ [ 14000 ]                 ││
│  └───────────────────────────┘ └───────────────────────────┘│
│                                                              │
│  ┌ Formule ─────────────────────────────────────────────────┐│
│  │ (176.5 × 18 × 2 + 1 200) / 14 000                      ││
│  │                                                          ││
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐           ││
│  │ │ Km trajet  │ │ Km pro     │ │ % déduc.   │           ││
│  │ │ 6 354      │ │ 7 554      │ │ 54,0 %     │           ││
│  │ └────────────┘ └────────────┘ └────────────┘           ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░                          │
│  46,0 % perso              54,0 % pro                       │
│                                                              │
│  ┌ ⓘ Poste comptable actuel ─────────────────────────────┐ │
│  │ Véhicule — déductible à 70 %            −16,0 pts     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│                    [ Appliquer 54,0 % au poste Véhicule ]   │
└──────────────────────────────────────────────────────────────┘
```

- 4 champs `<input type="number">` en grid 2×2, `onBlur` → persist config
- `jours_travaillés` : `step={0.5}` (décimales, cohérent blanchissage)
- Zone grise avec formule en `font-mono` + 3 MetricCards (même composant `MetricCard`)
- Barre de progression pro/perso avec labels %
- Encadré info : poste actuel + badge delta (warning si baisse, success si hausse, neutre si =0)
- Bouton vert "Appliquer {ratio}% au poste Véhicule" — disabled si `kmTotaux <= 0` ou `distance <= 0`

**Rendu — État 2 : Déjà appliqué (`genere` non null) :**

```
┌──────────────────────────────────────────────────────────────┐
│  ✓ Poste Véhicule mis à jour (54,0 %)                      │
│  ✓ PDF rapport généré                                       │
│  ✓ GED enregistré                                           │
│                                                              │
│  [PDF] quote_part_vehicule_2025.pdf                         │
│        Quote-part pro véhicule · 31/12/2025 · 54,0 %       │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │                   Aperçu PDF (280px)            [⬜ max]││
│  │            <object type="application/pdf" />             ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  [ Ouvrir dans la GED ]  [ Regénérer ]  [ ✉ Envoyer ]     │
└──────────────────────────────────────────────────────────────┘
```

- Checklist 3 lignes avec ✓ vert (même style que blanchissage)
- Bloc fichier PDF avec icône rouge, nom, metadata
- **Aperçu PDF inline** : `<object type="application/pdf" data={previewUrl}>` en hauteur compacte 280px, toggle Maximize2/Minimize2 pour 700px (même pattern que blanchissage). URL via `GET /api/ged/documents/{ged_doc_id}/preview`
- "Ouvrir dans la GED" → `navigate('/ged?type=rapport&search=quote_part_vehicule')`
- "Regénérer" → dialog confirmation → supprime puis retour état 1
- **"Envoyer au comptable"** → `openSendDrawer({ defaultSubject: "Quote-part véhicule 2025 — 54,0%" })` avec icône Send

---

## Étape 9 — Intégration dans ChargesForfaitairesPage

### Modifier `frontend/src/components/charges-forfaitaires/ChargesForfaitairesPage.tsx`

L'onglet Véhicule est le deuxième tab. La structure tabs existe déjà.

```typescript
import VehiculeTab from './VehiculeTab';

// Dans le state des tabs (si pas déjà un state, ajouter) :
const [activeTab, setActiveTab] = useState<'blanchissage' | 'vehicule'>('blanchissage');

// Dans les tabs du header :
const tabs = [
  { id: 'blanchissage', label: 'Blanchissage' },
  { id: 'vehicule', label: 'Véhicule' },
];

// Dans le rendu conditionnel :
{activeTab === 'blanchissage' && <BlanchissageTab year={year} />}
{activeTab === 'vehicule' && <VehiculeTab year={year} />}
```

### Partage `jours_travaillés`

Le champ `jours_travailles` dans `data/charges_forfaitaires_config.json` est **unique par année** et partagé entre les deux onglets. Quand l'utilisateur modifie les jours dans un onglet et fait blur, la config est mise à jour. Quand il switch d'onglet, `useChargesForfaitairesConfig(year)` recharge et le gate `configReady` re-seed le state local.

Pas de sync bidirectionnelle complexe — la config partagée fait office de source de vérité.

---

## Étape 10 — Intégration Simulation BNC

Le véhicule n'est pas une charge forfaitaire OD — c'est un ratio permanent. L'intégration dans la simulation est **déjà automatique** via le `deductible_pct` du poste.

Dans la section "Charges forfaitaires" de la page Simulation (ajoutée par le blanchissage), afficher une **ligne informative** (pas de checkbox) :

```tsx
import { Car } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useVehiculeGenere } from '../../hooks/useChargesForfaitaires';

const { data: vehiculeGenere } = useVehiculeGenere(year);

// Après les checkboxes des forfaits OD (blanchissage) :
{vehiculeGenere && (
  <div className="flex items-center gap-3 py-1 opacity-70">
    <Car className="w-4 h-4 text-secondary" />
    <span className="text-sm">Quote-part véhicule</span>
    <span className="ml-auto text-sm font-medium">{vehiculeGenere.ratio_pro}%</span>
  </div>
)}
{!vehiculeGenere && (
  <div className="flex items-center gap-3 py-1 opacity-40">
    <Car className="w-4 h-4" />
    <span className="text-sm">Quote-part véhicule</span>
    <Link to="/charges-forfaitaires" className="ml-auto text-xs text-info hover:underline">
      Configurer →
    </Link>
  </div>
)}
```

Pas de checkbox : le ratio est permanent et s'applique via le poste GED, pas via une OD ponctuelle.

---

## Vérification

### Backend
- [ ] Champs `vehicule_distance_km`, `vehicule_km_supplementaires`, `vehicule_km_totaux_compteur` acceptés par `PUT /api/charges-forfaitaires/config?year=2025`
- [ ] `GET /api/charges-forfaitaires/config?year=2025` retourne les champs véhicule si renseignés
- [ ] `data/baremes/vehicule_2025.json` créé avec historique vide
- [ ] `GET /api/simulation/baremes/vehicule?year=2025` retourne le barème (fallback si absent)
- [ ] `POST /api/charges-forfaitaires/calculer/vehicule` avec `{year: 2025, distance: 18, jours: 176.5, km_sup: 1200, km_totaux: 14000}` retourne `ratio_pro = 54.0`
- [ ] Le calcul retourne `ancien_ratio` (valeur poste GED) et `delta_ratio`
- [ ] Validation Pydantic : `km_totaux_compteur > 0`
- [ ] Le ratio est plafonné à 100% (`min()` dans le calcul)
- [ ] `POST /api/charges-forfaitaires/appliquer/vehicule` met à jour `deductible_pct` du poste "vehicule" dans `ged_postes.json`
- [ ] Le PDF `quote_part_vehicule_2025.pdf` est créé dans `data/reports/` (pas `justificatifs/`)
- [ ] Le PDF contient : paramètres, formule, résultat, ancien/nouveau ratio, méthode
- [ ] Le PDF est enregistré dans la GED comme `type: "rapport"` avec `source_module: "charges-forfaitaires"` et `rapport_meta`
- [ ] La navigation GED → "Voir dans Charges forfaitaires" fonctionne (via `source_module`)
- [ ] `GET /api/charges-forfaitaires/vehicule/genere?year=2025` retourne `pdf_filename` + `ged_doc_id` si appliqué
- [ ] `GET /api/charges-forfaitaires/generes?year=2025` inclut le véhicule dans la liste
- [ ] `DELETE /api/charges-forfaitaires/supprimer/vehicule?year=2025` supprime PDF (`data/reports/`) + GED + réinitialise barème
- [ ] La config `jours_travailles` est partagée : modifier côté véhicule met à jour la même clé que blanchissage

### Frontend
- [ ] Onglet "Véhicule" visible dans les tabs de `/charges-forfaitaires`
- [ ] Champs pré-remplis depuis `useChargesForfaitairesConfig(year)` (pas de flash valeurs par défaut grâce au gate `configReady`)
- [ ] `jours_travaillés` en `step={0.5}` (décimales, cohérent blanchissage)
- [ ] Calcul live au changement de chaque input (debounce 300ms, gated par `configReady`)
- [ ] Persistence config au `onBlur` via `useUpdateChargesForfaitairesConfig`
- [ ] Formule affichée en `font-mono`, 3 MetricCards (km trajet, km pro, % déductible)
- [ ] Barre pro/perso avec labels %
- [ ] Badge delta par rapport au poste actuel (warning/success/neutre)
- [ ] Bouton "Appliquer" disabled si `kmTotaux <= 0` ou `distance <= 0`
- [ ] Toast custom brandé (logo + gradient violet) sur succès application — même composant toast que blanchissage
- [ ] État "déjà appliqué" avec checklist 3✓ et bloc fichier PDF
- [ ] Aperçu PDF inline compact (280px) avec toggle Maximize2/Minimize2 (700px) — même pattern que blanchissage
- [ ] Bouton "Ouvrir dans la GED" → `/ged?type=rapport&search=quote_part_vehicule`
- [ ] Bouton "Regénérer" → dialog confirmation → supprime et retour état saisie
- [ ] Bouton "Envoyer au comptable" → `sendDrawerStore.open({ defaultSubject })` avec objet pré-rempli
- [ ] Simulation BNC : ligne informative véhicule avec ratio affiché (pas de checkbox)
- [ ] Simulation BNC : lien "Configurer →" si véhicule non appliqué
- [ ] `npx tsc --noEmit` passe sans erreur
