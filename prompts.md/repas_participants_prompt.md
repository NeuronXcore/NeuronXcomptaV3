# Prompt Claude Code — Repas pro : sous-catégories + participants

## Contexte

NeuronXcompta V3 — FastAPI + React 19 + TypeScript. Stack complète décrite dans CLAUDE.md.

La catégorie **Repas pro** vient d'être créée. Il faut :
1. Créer 2 sous-catégories : `Repas seul` et `Repas confrères`
2. Exempter `Repas seul` de justificatif obligatoire (mode forfait CF)
3. Ajouter un champ `participants` sur les opérations, visible uniquement pour `Repas confrères`
4. Ajouter la règle ML `UBER EATS` → `Perso`

---

## Étape 1 — Sous-catégories via category_service (backend)

Dans `backend/services/category_service.py`, repérer la fonction d'initialisation des catégories par défaut (probablement appelée au démarrage ou `ensure_defaults()`).

Ajouter, **après** la création de `Repas pro` si elle n'existe pas déjà :

```python
# Sous-catégories Repas pro
for subcat in ["Repas seul", "Repas confrères"]:
    if subcat not in existing_subcats_for("Repas pro"):
        add_subcategory("Repas pro", subcat)
```

S'il n'existe pas de mécanisme d'initialisation, appeler directement `POST /api/categories/subcategory` via un script de migration one-shot dans `backend/migrations/` ou via un appel dans le `lifespan()` de `main.py`.

**Important** : idempotent — ne pas recréer si déjà présent.

---

## Étape 2 — Exemption justificatif pour `Repas seul`

Dans `backend/services/settings_service.py` (ou là où `justificatif_exemptions` est initialisé par défaut) :

Ajouter à la liste des exemptions par défaut :
```python
{"categorie": "Repas pro", "sous_categorie": "Repas seul"}
```

La logique `is_justificatif_required()` filtre déjà par sous-catégorie si le champ est présent dans `appSettings.justificatif_exemptions`. Vérifier que le matching sous-catégorie fonctionne (comparaison exacte insensible à la casse).

Si le schema de `justificatif_exemptions` n'a pas de champ `sous_categorie`, l'étendre :
```python
class JustificatifExemption(BaseModel):
    categorie: str
    sous_categorie: Optional[str] = None  # None = toute la catégorie
```

Et adapter `is_justificatif_required()` :
```python
def is_justificatif_required(op: dict, exemptions: list) -> bool:
    for ex in exemptions:
        if op.get("Catégorie") == ex.categorie:
            if ex.sous_categorie is None:
                return False
            if op.get("Sous-catégorie") == ex.sous_categorie:
                return False
    return True
```

---

## Étape 3 — Champ `participants` sur Operation

### 3a. Backend — modèle Pydantic

Dans `backend/models/operation.py` (ou le fichier contenant le modèle Operation) :

```python
class Operation(BaseModel):
    # ... champs existants ...
    participants: Optional[str] = None  # Noms + qualité, repas confrères uniquement
```

Le champ est persisté dans le JSON opération comme tous les autres. Aucun endpoint nouveau nécessaire — le `PUT /api/operations/{filename}` sauvegarde le tableau complet.

### 3b. Frontend — TypeScript interface

Dans `frontend/src/types/index.ts`, ajouter à l'interface `Operation` :
```typescript
participants?: string | null;
```

### 3c. Frontend — composant `ParticipantsCell`

Créer `frontend/src/components/editor/ParticipantsCell.tsx` :

```tsx
// Affiche un bouton Users2 dans l'EditorPage.
// Visible UNIQUEMENT si sous_categorie === "Repas confrères".
// Ouvre un popover inline avec textarea pour saisir les participants.
// Format suggéré : "Dr Martin (chirurgien), Dr Blanc (anesthésiste)"
// onSave(value: string) : callback vers EditorPage pour persister dans l'op.
```

Props :
```typescript
interface ParticipantsCellProps {
  value: string | null | undefined;
  onSave: (value: string) => void;
  disabled?: boolean;
}
```

Comportement :
- Icône `Users2` (Lucide, 16px) colorée `text-violet-400` si participants remplis, `text-text-muted` sinon
- Badge compteur (nombre de participants détectés par split `,`) à droite de l'icône si rempli
- Clic → popover (Radix ou div positionnée en absolute) avec :
  - `<textarea>` 3 lignes, placeholder `"Dr Martin (chirurgien), Dr Blanc (cardiologue)..."`
  - Bouton Enregistrer + Esc pour fermer
  - `onSave` appelé au clic Enregistrer ou `Ctrl+Enter`
- Fond `bg-surface`, border `border-border`, `rounded-lg`, `shadow-lg`

### 3d. Frontend — intégration dans EditorPage

Dans `frontend/src/components/EditorPage.tsx` (ou le fichier de la table TanStack) :

Ajouter une colonne conditionnelle **après** la colonne `Sous-catégorie` :

```typescript
{
  id: 'participants',
  header: () => <Users2 size={14} className="text-text-muted" />,
  size: 40,
  cell: ({ row }) => {
    const op = row.original;
    if (op['Sous-catégorie'] !== 'Repas confrères') return null;
    return (
      <ParticipantsCell
        value={op.participants}
        onSave={(val) => handleParticipantsSave(row.index, val)}
      />
    );
  },
}
```

`handleParticipantsSave(index, value)` : met à jour `op.participants` dans le state local et déclenche `saveMutation` (même pattern que les autres éditions inline).

La colonne est toujours rendue dans l'en-tête mais la cellule est `null` pour les autres sous-catégories → largeur fixe 40px, quasi invisible sur les autres lignes.

---

## Étape 4 — Règle ML UBER EATS → Perso

Dans `backend/services/ml_service.py`, dans la fonction d'initialisation ou de chargement du modèle, ajouter les règles exactes si absentes :

```python
default_rules = [
    # ... règles existantes ...
    {"libelle": "UBER EATS", "categorie": "Perso", "sous_categorie": ""},
    {"libelle": "UBEREATS", "categorie": "Perso", "sous_categorie": ""},
    {"libelle": "UBER*EATS", "categorie": "Perso", "sous_categorie": ""},
]
```

Ou appeler `POST /api/ml/rules` programmatiquement au démarrage pour ces 3 variantes.

**Alternative** : si le moteur de règles supporte les keywords, ajouter `"ubereats"` comme keyword → `Perso` dans `model.json`.

---

## Vérification

- [ ] `GET /api/categories/Repas pro/subcategories` retourne `["Repas seul", "Repas confrères"]`
- [ ] Opération avec `Sous-catégorie: "Repas seul"` → exemptée dans JustificatifsPage (icône bleu ciel)
- [ ] Opération avec `Sous-catégorie: "Repas confrères"` → icône `Users2` visible dans EditorPage
- [ ] Saisie participants → persisté dans le JSON opération après save
- [ ] `POST /api/ml/predict` avec libellé `"UBER EATS"` → `{ "best_prediction": "Perso" }`
- [ ] Idempotence : redémarrage backend ne duplique pas les sous-catégories ni les règles

---

## Notes

- Python 3.9 : `from __future__ import annotations` dans tous les fichiers backend modifiés
- Dark theme : toutes les couleurs via CSS variables (`bg-surface`, `border-border`, etc.)
- `PageHeader` utilise prop `actions`, pas `children`
- Ne pas créer de nouveaux endpoints — réutiliser `PUT /api/operations/{filename}` pour persister `participants`
