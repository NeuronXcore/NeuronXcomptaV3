# Prompt — Batch Génération Fac-similé depuis Templates

> Lis `CLAUDE.md` en entier avant de commencer. Respecte strictement l'ordre d'implémentation.

## Contexte

Le module Templates Justificatifs permet de créer des templates fournisseur et de générer des reconstitués unitaires (fac-similé PDF). On ajoute deux fonctionnalités :

1. **Édition détaillée** des templates dans la bibliothèque (vendor, aliases, catégorie, champs, coordonnées)
2. **Génération batch** : à partir d'un template, trouver toutes les opérations matchantes sans justificatif sur une année, et générer les fac-similés d'un coup avec auto-association

## Ordre d'implémentation

1. Backend — Modèles Pydantic
2. Backend — Service (2 nouvelles fonctions batch)
3. Backend — Router (2 nouveaux endpoints batch)
4. Frontend — Types TypeScript
5. Frontend — Hooks TanStack Query
6. Frontend — Composant TemplateEditDrawer (édition détaillée)
7. Frontend — Composant BatchGenerateDrawer
8. Frontend — Intégration dans l'onglet Templates existant

---

## 1. Backend — Modèles Pydantic

**Fichier : `backend/models/template_models.py`** (ou là où sont les modèles templates actuels)

Ajouter :

```python
class BatchCandidatesRequest(BaseModel):
    template_id: str
    year: int

class BatchCandidate(BaseModel):
    operation_file: str
    operation_index: int
    date: str
    libelle: str
    montant: float  # debit ou credit, valeur absolue
    mois: int  # 1-12, extrait de la date

class BatchCandidatesResponse(BaseModel):
    template_id: str
    vendor: str
    year: int
    candidates: list[BatchCandidate]
    total: int

class BatchGenerateRequest(BaseModel):
    template_id: str
    operations: list[dict]  # [{operation_file, operation_index}, ...]

class BatchGenerateResult(BaseModel):
    operation_file: str
    operation_index: int
    filename: str | None = None  # nom du reconstitué généré
    associated: bool = False
    error: str | None = None

class BatchGenerateResponse(BaseModel):
    generated: int
    errors: int
    total: int
    results: list[BatchGenerateResult]
```

---

## 2. Backend — Service

**Fichier : `backend/services/template_service.py`**

### Fonction `find_batch_candidates(template_id: str, year: int) -> BatchCandidatesResponse`

Logique :
1. Charger le template par ID → récupérer `vendor_aliases`
2. Lister tous les fichiers d'opérations de l'année (`year`) via `operation_service.list_files()` — filtrer par année dans le nom du fichier
3. Pour chaque fichier, charger les opérations
4. Pour chaque opération :
   - Vérifier qu'elle n'a PAS de justificatif (`Justificatif` est `false` ou vide, ET `Lien justificatif` est vide)
   - Si l'opération est ventilée (`categorie == "Ventilé"` ou `ventilation` non vide), itérer les sous-lignes et vérifier chaque sous-ligne individuellement (une sous-ligne sans justificatif = un candidat avec `ventilation_index`)
   - Vérifier que le libellé matche au moins un alias (case-insensitive, recherche par sous-chaîne : `alias.lower() in libelle.lower()`)
   - Si match → ajouter en `BatchCandidate`
5. Trier par date croissante
6. Retourner le tout

**Important :** Réutiliser la même logique de matching alias que `suggest_templates_for_operation()` déjà existant.

### Fonction `batch_generate(template_id: str, operations: list[dict]) -> BatchGenerateResponse`

Logique :
1. Pour chaque opération dans la liste :
   - Appeler la fonction `generate_reconstitue()` existante avec `template_id`, `operation_file`, `operation_index`, `auto_associate=True`, `field_values={}`
   - Capturer le résultat ou l'erreur
   - Un `time.sleep(0.1)` entre chaque génération pour éviter les collisions de timestamp dans le nommage `reconstitue_YYYYMMDD_HHMMSS_vendor.pdf`
2. Compter generated/errors
3. Retourner `BatchGenerateResponse`

**Ne PAS modifier** la fonction `generate_reconstitue()` existante — la réutiliser telle quelle.

---

## 3. Backend — Router

**Fichier : `backend/routers/template_router.py`**

### `POST /api/templates/batch-candidates`

```python
@router.post("/batch-candidates", response_model=BatchCandidatesResponse)
async def get_batch_candidates(request: BatchCandidatesRequest):
    return template_service.find_batch_candidates(request.template_id, request.year)
```

### `POST /api/templates/batch-generate`

```python
@router.post("/batch-generate", response_model=BatchGenerateResponse)
async def batch_generate(request: BatchGenerateRequest):
    return template_service.batch_generate(request.template_id, request.operations)
```

---

## 4. Frontend — Types TypeScript

**Fichier : `frontend/src/types/template.ts`** (ou là où sont les types templates)

Ajouter :

```typescript
export interface BatchCandidate {
  operation_file: string;
  operation_index: number;
  date: string;
  libelle: string;
  montant: number;
  mois: number;
}

export interface BatchCandidatesResponse {
  template_id: string;
  vendor: string;
  year: number;
  candidates: BatchCandidate[];
  total: number;
}

export interface BatchGenerateResult {
  operation_file: string;
  operation_index: number;
  filename: string | null;
  associated: boolean;
  error: string | null;
}

export interface BatchGenerateResponse {
  generated: number;
  errors: number;
  total: number;
  results: BatchGenerateResult[];
}
```

---

## 5. Frontend — Hooks

**Fichier : `frontend/src/hooks/useTemplates.ts`** (ajouter aux hooks existants)

```typescript
export function useBatchCandidates(templateId: string | null, year: number) {
  return useQuery({
    queryKey: ['templates', 'batch-candidates', templateId, year],
    queryFn: async () => {
      const res = await fetch('/api/templates/batch-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId, year }),
      });
      if (!res.ok) throw new Error('Erreur chargement candidats');
      return res.json() as Promise<BatchCandidatesResponse>;
    },
    enabled: !!templateId,
  });
}

export function useBatchGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { template_id: string; operations: { operation_file: string; operation_index: number }[] }) => {
      const res = await fetch('/api/templates/batch-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('Erreur génération batch');
      return res.json() as Promise<BatchGenerateResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] });
      queryClient.invalidateQueries({ queryKey: ['rapprochement'] });
      queryClient.invalidateQueries({ queryKey: ['cloture'] });
      queryClient.invalidateQueries({ queryKey: ['alertes'] });
    },
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, data }: { templateId: string; data: TemplateUpdatePayload }) => {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Erreur mise à jour template');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
```

Type `TemplateUpdatePayload` (ajouter dans les types) :

```typescript
export interface TemplateUpdatePayload {
  vendor: string;
  vendor_aliases: string[];
  category: string;
  sous_categorie: string;
  fields: TemplateField[];
}
```

---

## 6. Frontend — TemplateEditDrawer (édition détaillée)

**Fichier : `frontend/src/components/templates/TemplateEditDrawer.tsx`**

Drawer 700px, pattern standard (translateX + backdrop). **Mode lecture par défaut**, bascule en édition via bouton "Modifier".

### Props

```typescript
interface TemplateEditDrawerProps {
  templateId: string | null;
  onClose: () => void;
}
```

### Section haute — Infos fournisseur

**Mode lecture :**
- Vendor affiché en titre `text-xl font-semibold`
- Aliases affichés en chips gris (badges arrondis)
- Catégorie / sous-catégorie en texte
- `usage_count` + `created_at` en texte discret
- Bouton "Modifier" (icône `Pencil`) en haut à droite

**Mode édition :**
- Vendor → `<input>` texte
- Aliases → chips éditables : chaque chip a un `×` pour supprimer, un champ `<input>` en fin de liste + bouton `+` ou `Enter` pour ajouter. Pas de doublon, tout en lowercase, trim automatique.
- Catégorie → dropdown (réutiliser la liste de catégories existante du projet, même source que EditorPage)
- Sous-catégorie → dropdown conditionnel (filtre sur la catégorie sélectionnée)

### Section centrale — Table des champs

Tableau éditable avec colonnes :

| Colonne | Mode lecture | Mode édition |
|---------|-------------|--------------|
| Key | texte | `<input>` (slug, pas d'espaces) |
| Label | texte | `<input>` |
| Type | badge | `<select>` : text, date, currency, number, percent, select |
| Source | badge couleur | `<select>` : operation, ocr, manual, computed, fixed |
| Défaut | texte ou `—` | `<input>` (affiché si source = fixed) |
| Formule | code mono | `<input>` (affiché si source = computed) |
| Actions | — | bouton `Trash2` pour supprimer la ligne |

**Bouton "Ajouter un champ"** en bas du tableau (icône `Plus`). Ajoute une ligne vide avec des valeurs par défaut (`key: "", label: "", type: "text", source: "manual"`).

Les champs `date` et `montant_ttc` avec `source: "operation"` sont marqués d'un badge `AUTO` et ne sont pas supprimables (ce sont les champs essentiels du fac-similé).

### Section basse — Preview PDF source

- Thumbnail large du PDF source (`source_justificatif`) affiché dans un `<object>` iframe ou image rasterisée
- Si le template a des `FieldCoordinates`, les zones sont surlignées en overlay semi-transparent :
  - Vert pour les champs `source: "operation"` (date, montant — auto-remplacés)
  - Bleu pour les champs `source: "manual"` ou `"fixed"`
  - Orange pour les champs `source: "computed"`
- Légende couleur sous la preview

### Footer sticky

**Mode lecture :**
- Bouton "Modifier" (icône `Pencil`, border style)
- Bouton "Supprimer" (icône `Trash2`, rouge, confirmation par toast ou modal)

**Mode édition :**
- Bouton "Annuler" (gris, reset au state initial)
- Bouton "Sauvegarder" (bg-orange-500, appelle `useUpdateTemplate` → `PUT /api/templates/{id}`)
- Désactivé si vendor vide ou 0 aliases ou champs date/montant_ttc manquants
- Toast success "Template mis à jour" post-save, repasse en mode lecture

### State interne

```typescript
const [editing, setEditing] = useState(false);
const [draft, setDraft] = useState<TemplateUpdatePayload | null>(null);
// draft initialisé depuis les données du template au clic "Modifier"
// reset au clic "Annuler"
```

---

## 7. Frontend — BatchGenerateDrawer

**Fichier : `frontend/src/components/templates/BatchGenerateDrawer.tsx`**

Drawer 700px, pattern standard (translateX + backdrop).

### Props

```typescript
interface BatchGenerateDrawerProps {
  templateId: string | null;
  vendor: string;
  onClose: () => void;
}
```

### Contenu

**Header :**
- Titre : `"Génération batch — {vendor}"`
- Icône `Layers` (lucide)

**Sélecteur année :**
- Boutons `◀ ANNÉE ▶` comme le pattern global (useFiscalYearStore pour la valeur initiale)
- Le changement d'année relance la requête `useBatchCandidates`

**Liste des candidats :**
- Checkbox "Tout sélectionner" en haut (checked par défaut, état intermédiaire si partiel)
- Tableau compact :
  - `☑` checkbox
  - Date (format `DD/MM/YYYY`)
  - Libellé (tronqué 40 chars)
  - Montant (format `XX,XX €`, aligné droite)
- Tous cochés par défaut
- Compteur : `"{N} opérations sélectionnées sur {total}"`

**État vide :**
- Si 0 candidats : message `"Aucune opération sans justificatif ne correspond aux aliases de ce template pour {year}."`
- Icône `CheckCircle2` verte + message positif

**Footer sticky :**
- Bouton principal : `"Générer {N} fac-similés"` (bg-orange-500, désactivé si N=0)
- Pendant la génération : spinner + texte `"Génération en cours... {i}/{N}"`

**Post-génération :**
- Toast success : `"✓ {generated} fac-similés générés{errors > 0 ? `, ${errors} erreurs` : ''}"`
- Le drawer reste ouvert et affiche le résumé (badges vert/rouge par opération)
- Bouton "Fermer" remplace "Générer"

### Style
- Dark theme (CSS variables existantes)
- Lignes alternées sur le tableau (`bg-card/bg-background`)
- Checkbox orange (pattern existant `CheckboxCell`)
- Montants en `font-mono`

---

## 8. Intégration dans l'onglet Templates

**Fichier : `frontend/src/components/ocr/TemplateLibrary.tsx`** (ou le composant qui affiche la grille de cards templates)

Sur chaque carte template dans la bibliothèque :

**Boutons d'action (row, en bas de la carte ou au hover) :**
- Icône `Pencil` → ouvre `TemplateEditDrawer` avec le `templateId`
- Icône `Layers` + texte `"Batch"` → ouvre `BatchGenerateDrawer` avec le `templateId` et `vendor`
- Icône `Trash2` (rouge) → suppression (existant)

**Clic sur la carte elle-même (zone body)** → ouvre `TemplateEditDrawer` en mode lecture.

Importer et rendre les deux drawers dans le composant parent (conditionnels).

State à ajouter :
```typescript
const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
const [batchTemplateId, setBatchTemplateId] = useState<string | null>(null);
const [batchVendor, setBatchVendor] = useState<string>('');
```

---

## Vérification

- [ ] `POST /api/templates/batch-candidates` retourne les opérations sans justificatif matchant les aliases du template pour l'année donnée
- [ ] Les opérations ventilées sont gérées (sous-lignes sans justificatif = candidats individuels)
- [ ] `POST /api/templates/batch-generate` appelle `generate_reconstitue()` pour chaque opération sélectionnée avec `auto_associate=True`
- [ ] **TemplateEditDrawer** : mode lecture affiche toutes les infos (vendor, aliases, catégorie, champs, preview PDF)
- [ ] **TemplateEditDrawer** : mode édition permet de modifier vendor, aliases (chips add/remove), catégorie/sous-catégorie, et la table de champs
- [ ] **TemplateEditDrawer** : "Sauvegarder" appelle `PUT /api/templates/{id}` et repasse en lecture
- [ ] **TemplateEditDrawer** : les champs `date` et `montant_ttc` (source operation) ne sont pas supprimables
- [ ] **TemplateEditDrawer** : la preview PDF montre les zones coordonnées surlignées par couleur de source
- [ ] Le drawer batch affiche la liste complète avec checkboxes, tout coché par défaut
- [ ] Décocher des opérations les exclut de la génération
- [ ] Le bouton "Générer" lance le batch et affiche le résumé
- [ ] Les caches TanStack sont invalidés post-génération (justificatifs, rapprochement, clôture, alertes)
- [ ] Clic sur une carte template → ouvre TemplateEditDrawer en lecture
- [ ] Bouton Batch sur la carte → ouvre BatchGenerateDrawer
- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] Pas de `any` dans le code TypeScript
- [ ] Le `usage_count` du template est incrémenté pour chaque génération réussie
