# Prompt Claude Code — Charges Forfaitaires : onglet Repas

## Contexte

NeuronXcompta V3 — FastAPI + React 19 + TypeScript. Stack complète dans CLAUDE.md.

Le module Charges Forfaitaires existe avec l'onglet **Blanchissage** pleinement fonctionnel. Ajouter l'onglet **Repas** en suivant exactement le même pattern (barème JSON versionné, endpoints dédiés, état saisie/généré, OD décembre, PDF ReportLab, GED).

---

## Étape 1 — Barème JSON

Créer `data/baremes/repas_2026.json` :

```json
{
  "year": 2026,
  "seuil_repas_maison": 5.35,
  "plafond_repas_restaurant": 20.20,
  "reference_legale": "BOI-BNC-BASE-40-60",
  "source": "URSSAF 2026"
}
```

Même structure pour les années antérieures si pertinent. Le `forfait_jour` = `plafond_repas_restaurant − seuil_repas_maison` est toujours **calculé**, jamais stocké.

---

## Étape 2 — Backend service

Dans `backend/services/charges_forfaitaires_service.py`, ajouter les méthodes suivantes à la classe `ChargesForfaitairesService` :

### `load_bareme_repas(year: int) -> dict`
Charge `data/baremes/repas_{year}.json`. Fallback sur l'année la plus récente disponible (même logique que `load_bareme_blanchissage`).

### `calculer_repas(year: int, jours_travailles: float) -> ForfaitResult`
```python
bareme = load_bareme_repas(year)
forfait_jour = bareme["plafond_repas_restaurant"] - bareme["seuil_repas_maison"]
montant_deductible = round(forfait_jour * jours_travailles, 2)

return ForfaitResult(
    montant_deductible=montant_deductible,
    cout_jour=round(forfait_jour, 2),
    detail=[
        {"label": "Seuil repas maison", "valeur": bareme["seuil_repas_maison"], "unite": "€/jour"},
        {"label": "Plafond repas restaurant", "valeur": bareme["plafond_repas_restaurant"], "unite": "€/jour"},
        {"label": "Forfait déductible", "valeur": round(forfait_jour, 2), "unite": "€/jour"},
        {"label": "Jours travaillés", "valeur": jours_travailles, "unite": "jours"},
    ],
    reference_legale=bareme["reference_legale"]
)
```

### `generer_repas(year: int, jours_travailles: float) -> dict`
Même logique que `generer_blanchissage` :
1. Calcul via `calculer_repas()`
2. Déduplication OD : marker `"Charge forfaitaire repas {year}"` dans `Commentaire`
3. Insertion OD dans fichier opérations de décembre `{year}`
4. Génération PDF ReportLab → `data/reports/repas_{year}1231_{montant}.pdf`
5. Enregistrement GED : `type="rapport"`, `source_module="charges-forfaitaires"`, `rapport_meta.title=f"Forfait repas {year}"`
6. Retourne `{ od_filename, od_index, pdf_filename, ged_doc_id, montant }`

**OD à insérer :**
```python
{
    "Date": f"{year}-12-31",
    "Libellé": f"Forfait repas professionnels {year} — BOI-BNC-BASE-40-60",
    "Débit": montant_deductible,
    "Crédit": 0,
    "Catégorie": "Repas pro",
    "Sous-catégorie": "Repas seul",
    "Commentaire": f"Charge forfaitaire repas {year}",
    "Pointée": False,
}
```

### `supprimer_repas(year: int) -> dict`
Supprime OD (marker `"Charge forfaitaire repas {year}"`), PDF et entrée GED. Même pattern que `supprimer_blanchissage`.

---

## Étape 3 — Backend router

Dans `backend/routers/charges_forfaitaires.py`, ajouter :

### `POST /calculer/repas`
```python
class RepasCalculRequest(BaseModel):
    year: int
    jours_travailles: float

@router.post("/calculer/repas")
async def calculer_repas(req: RepasCalculRequest):
    return service.calculer_repas(req.year, req.jours_travailles)
```

### `POST /generer` — étendre le handler existant
Ajouter `type_forfait: "repas"` comme cas valide. Body :
```json
{
  "type_forfait": "repas",
  "year": 2026,
  "jours_travailles": 176.0
}
```
Erreur 409 si un forfait repas existe déjà pour l'année.

### `DELETE /supprimer/repas?year=2026`
Utiliser le handler générique existant ou ajouter un cas pour `repas`.

### `GET /bareme/repas?year=2026`
Retourne le barème chargé + `forfait_jour` calculé :
```json
{
  "year": 2026,
  "seuil_repas_maison": 5.35,
  "plafond_repas_restaurant": 20.20,
  "forfait_jour": 14.85,
  "reference_legale": "BOI-BNC-BASE-40-60",
  "source": "URSSAF 2026"
}
```

---

## Étape 4 — Config partagée

Le champ `jours_travailles` dans `data/charges_forfaitaires_config.json` est **partagé** entre Blanchissage et Repas (même valeur, persistée une seule fois par année). Aucun changement de schéma nécessaire.

Ajouter dans le schéma de config si absent :
```python
class ChargesForfaitairesConfig(BaseModel):
    jours_travailles: Optional[float] = None
    honoraires_liasse: Optional[float] = None
    # pas de champ repas séparé — jours_travailles est commun
```

---

## Étape 5 — Frontend hooks

Dans `frontend/src/hooks/useChargesForfaitaires.ts`, ajouter :

```typescript
// Barème repas
export function useBaremeRepas(year: number) {
  return useQuery({
    queryKey: ['bareme-repas', year],
    queryFn: () => api.get(`/charges-forfaitaires/bareme/repas?year=${year}`),
  });
}

// Calcul repas (mutation, appelée en live avec debounce 300ms)
export function useCalculerRepas() {
  return useMutation({
    mutationFn: (data: { year: number; jours_travailles: number }) =>
      api.post('/charges-forfaitaires/calculer/repas', data),
  });
}

// Générer repas
export function useGenererRepas() {
  return useMutation({
    mutationFn: (data: { year: number; jours_travailles: number }) =>
      api.post('/charges-forfaitaires/generer', { ...data, type_forfait: 'repas' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges-forfaitaires-generes'] });
    },
  });
}

// Supprimer repas
export function useSupprimerRepas() {
  return useMutation({
    mutationFn: (year: number) =>
      api.delete(`/charges-forfaitaires/supprimer/repas?year=${year}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges-forfaitaires-generes'] });
    },
  });
}
```

---

## Étape 6 — Frontend composant RepasTab

Créer `frontend/src/components/charges-forfaitaires/RepasTab.tsx`.

### Structure (2 états, même pattern que BlanchissageTab)

**État 1 — Saisie :**

```
InfoBox BOI-BNC-BASE-40-60 (fond violet 50, texte violet 800)

Card "Paramètre"
  └─ Input "Jours travaillés" (number, step=0.5, partagé config)
     └─ Note "↗ partagé avec Blanchissage"

3 MetricCards (grid 3 colonnes)
  ├─ Seuil repas maison : 5,35 €  (URSSAF {year})
  ├─ Plafond restaurant : 20,20 € (URSSAF {year})
  └─ Forfait / jour : XX,XX €     (accent violet — calculé)

Card "Barème URSSAF {year}"
  └─ Tableau 3 colonnes (Paramètre / Valeur / Source)
     ├─ Seuil repas maison      | 5,35 €  | URSSAF — non éditable
     ├─ Plafond restaurant      | 20,20 € | URSSAF — non éditable
     ├─ Forfait déductible/jour | XX,XX € | Calculé automatiquement (violet)
     └─ Total déductible (N j)  | XXXX €  | = forfait × jours (violet)

Footer
  ├─ Badge référence BOI-BNC-BASE-40-60
  └─ Bouton "Générer l'écriture" (violet, disabled si jours=0)
```

**Calcul live côté client** (pas d'appel API à chaque frappe) :
```typescript
const forfaitJour = bareme ? bareme.plafond_repas_restaurant - bareme.seuil_repas_maison : 0;
const totalDeductible = forfaitJour * jours;
```
Appel `useCalculerRepas` uniquement au clic "Générer" pour validation serveur avant OD.

**État 2 — Généré :**
Identique à BlanchissageTab :
- Checklist 3✓ (OD / PDF / GED)
- Bloc fichier PDF : `repas_{year}1231_{montant}.pdf`
- Boutons : Ouvrir GED / Regénérer / Envoyer au comptable / Supprimer (rouge)

**Toast custom à la génération** : même toast brandé (logo + gradient violet) que Blanchissage. Message : `"Forfait repas {year} généré — {montant} €"`

---

## Étape 7 — Intégration dans ChargesForfaitairesPage

Dans `frontend/src/pages/ChargesForfaitairesPage.tsx` :

1. Ajouter l'onglet **Repas** entre Blanchissage et Véhicule (tab existant préparé)
2. Rendre `<RepasTab year={selectedYear} />` quand l'onglet Repas est actif
3. Le tab Véhicule reste désactivé (opacity 0.5, cursor not-allowed)

---

## Étape 8 — Intégration Simulation BNC

Dans la section "Charges forfaitaires" de `SimulationPage`, ajouter une ligne **Repas** avec checkbox toggle (même pattern que Blanchissage) :

```typescript
// Dans le calcul BNC simulé :
if (leviers.repas_forfait) {
  bnc_simule -= repas_montant; // récupéré depuis /api/charges-forfaitaires/generes?year=X
}
```

Si le forfait repas n'est pas encore généré pour l'année, la checkbox est disabled avec tooltip "Générez d'abord le forfait dans Charges forfaitaires".

---

## Étape 9 — PDF ReportLab

Le rapport PDF repas (`repas_{year}1231_{montant}.pdf`) suit la même structure que le rapport blanchissage :
- Logo lockup en-tête
- Titre : `Charges forfaitaires — Repas professionnels {year}`
- Référence légale : `BOI-BNC-BASE-40-60`
- Tableau détail : seuil maison / plafond restaurant / forfait/jour / nb jours / total
- Mention : "Aucun justificatif requis pour ce forfait"
- Pied de page : `Page X/Y` + date génération

---

## Vérification

- [ ] `GET /api/charges-forfaitaires/bareme/repas?year=2026` retourne `forfait_jour: 14.85`
- [ ] `POST /calculer/repas` avec 176 jours → `montant_deductible: 2613.6`
- [ ] `POST /generer` type_forfait=repas → OD dans décembre + PDF + GED
- [ ] Erreur 409 si regénération sans suppression préalable
- [ ] `DELETE /supprimer/repas?year=2026` → suppression OD + PDF + GED
- [ ] Frontend : calcul live jours → total sans appel API
- [ ] Jours travaillés partagés : modifier dans Repas met à jour Blanchissage (même config key)
- [ ] Toast brandé à la génération
- [ ] État 2 : bouton Regénérer → supprime + régénère

---

## Notes

- Python 3.9 : `from __future__ import annotations` dans tous les fichiers modifiés
- Dark theme : CSS variables uniquement (`bg-surface`, `border-border`, etc.)
- Pas de nouveaux endpoints inutiles — réutiliser `/generer` et `/supprimer/{type}` génériques
- `ForfaitResult` Pydantic model déjà existant (partagé avec blanchissage)
- Le `forfait_jour` n'est jamais stocké dans le JSON — toujours recalculé à la volée
