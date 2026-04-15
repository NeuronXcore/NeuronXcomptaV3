# Prompt — Badge "Note de frais" dans EditorPage

Lis `CLAUDE.md` avant de commencer.

## Contexte

Les opérations créées manuellement dans l'éditeur (dépenses pro payées par carte perso — essence, péage, parking) doivent être distinguées visuellement des opérations issues du relevé bancaire. On ajoute un champ `source` sur le modèle `Operation` et un badge pill dans la cellule Catégorie.

---

## 1. Backend — Modèle Operation

### Fichier : `backend/models.py`

Ajouter le champ optionnel sur `Operation` :

```python
source: Optional[str] = None
# Valeurs connues : "note_de_frais", "blanchissage", "amortissement"
# None = opération bancaire normale
```

Aucune migration nécessaire (JSON, champ optionnel, backward-compatible).

---

## 2. Backend — Création de ligne manuelle

### Fichier : `backend/routers/operations.py`

Lors de la création d'une nouvelle opération vide (endpoint existant "ajouter une ligne"), si le body contient `source`, le persister tel quel dans le dict opération sauvegardé.

---

## 3. Frontend — Type Operation

### Fichier : `frontend/src/types/index.ts` (ou équivalent)

Ajouter :
```typescript
source?: string
```

---

## 4. Frontend — Badge dans EditorPage

### Fichier : `frontend/src/pages/EditorPage.tsx` (cellule colonne Catégorie)

Dans le rendu de la cellule `Catégorie`, **avant** le texte de la catégorie, afficher conditionnellement un badge si `op.source === "note_de_frais"` :

```tsx
{op.source === "note_de_frais" && (
  <span style={{
    display: 'inline-block',
    fontSize: '10px',
    fontWeight: 500,
    padding: '1px 6px',
    borderRadius: '4px',
    background: '#FAEEDA',
    color: '#854F0B',
    marginBottom: '2px',
    lineHeight: '16px',
  }}>
    Note de frais
  </span>
)}
```

Résultat visuel dans la cellule :
```
┌──────────────────────┐
│ Note de frais         │  ← pill amber 10px
│ Véhicule / Carburant  │  ← catégorie normale
└──────────────────────┘
```

Le badge est **read-only** — pas d'édition du champ `source` depuis l'éditeur.

---

## 5. Frontend — Création d'une ligne manuelle

### Fichier : `frontend/src/pages/EditorPage.tsx` (drawer ou modal "Ajouter une ligne")

Dans le formulaire de création d'une nouvelle ligne, ajouter un **select optionnel** "Type d'opération" :

```tsx
<select>
  <option value="">Opération bancaire</option>
  <option value="note_de_frais">Note de frais (CB perso)</option>
</select>
```

- Valeur par défaut : `""` (source = undefined, comportement normal)
- Si `"note_de_frais"` sélectionné : inclure `source: "note_de_frais"` dans le payload POST

---

## 6. Checklist

- [ ] Champ `source?: Optional[str]` ajouté au modèle Pydantic `Operation`
- [ ] Champ `source?: string` ajouté au type TypeScript `Operation`
- [ ] Badge amber affiché uniquement si `source === "note_de_frais"` (pas pour les autres valeurs)
- [ ] Badge positionné **au-dessus** du texte catégorie (flex-col ou display block)
- [ ] Select "Type d'opération" dans le formulaire de création manuelle
- [ ] `source` persisté dans le JSON opération au save
- [ ] Aucune régression sur les ops sans `source` (champ absent = comportement identique)
- [ ] Vue année complète : badge visible (read-only comme le reste)
- [ ] TypeScript strict, aucun `any`
