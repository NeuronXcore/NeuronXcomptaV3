# Fac-similé : template depuis zéro + catégorie/sous-catégorie

> Lis CLAUDE.md avant de commencer.

## Contexte

Le système de fac-similé actuel exige qu'un template soit créé depuis un **justificatif existant** (PDF réel déjà passé en OCR). On veut ajouter :

1. **Mode "template vierge"** — uploader directement un PDF graphique de template (ex: `template_repas_clinique_ELSAN.pdf`) sans qu'il soit un vrai justificatif, définir les champs variables manuellement, puis générer des fac-similés en batch.
2. **Catégorie + sous-catégorie sur les templates** — champs stockés sur le template, propagés automatiquement aux `.ocr.json` des fac-similés générés, pour affûter le score de rapprochement dès la génération.

---

## 1. Modèle backend — `FacsimileTemplate`

### Fichier : `backend/facsimile_service.py` (ou `models.py`)

Ajouter deux champs au modèle Pydantic `FacsimileTemplate` :

```python
class FacsimileTemplate(BaseModel):
    # ... champs existants ...
    category: Optional[str] = None           # ex: "Repas"
    sous_categorie: Optional[str] = None     # ex: "Déjeuner clinique"
    is_blank_template: bool = False          # True = créé depuis un PDF vierge
```

`is_blank_template=True` signifie que le PDF de fond n'est **pas** un vrai justificatif — pas d'OCR à relancer dessus, les champs variables sont déclarés manuellement.

---

## 2. Endpoint création depuis PDF vierge

### Fichier : `backend/routers/facsimile.py`

Ajouter l'endpoint :

```
POST /api/facsimile/templates/from-blank
```

**Body** : `multipart/form-data`
- `file` : PDF de fond (obligatoire)
- `vendor_name` : str
- `aliases` : JSON array de str (optionnel)
- `category` : str (optionnel)
- `sous_categorie` : str (optionnel)

**Logique** :
1. Sauvegarder le PDF dans `data/facsimile/templates/{template_id}/background.pdf`
2. Rasteriser page 0 → PNG thumbnail (`data/facsimile/templates/{template_id}/thumbnail.png`) via `pdf2image` + Pillow
3. Créer le template avec `is_blank_template=True`, `fields=[]` (liste vide — l'utilisateur définira les champs manuellement dans l'éditeur)
4. **Ne pas** lancer l'OCR sur ce PDF
5. Retourner le `FacsimileTemplate` créé

---

## 3. Éditeur de template — mode champs manuels

### Fichier : `frontend/src/components/FacsimileTemplateEditor.tsx` (existant)

Quand `template.is_blank_template === true` :

- **Masquer** le bouton « Relancer OCR » / « Détecter champs auto »
- **Afficher** un bouton `+ Ajouter un champ` qui ouvre un mini-formulaire :
  - `field_type` : select (`date` | `montant` | `montant_ht` | `montant_tva` | `texte_libre`)
  - `label` : string (ex: "Date de prestation")
  - `x`, `y`, `width`, `height` : coordonnées en points PDF (saisie numérique)
  - `default_value` : string optionnel
- Chaque champ ajouté apparaît dans le tableau existant des champs avec les mêmes contrôles d'édition/suppression
- Ajouter un mode **"positionner sur aperçu"** : cliquer sur le PDF preview → les coordonnées x/y/width/height se remplissent automatiquement (utiliser l'event `onClick` sur le `<canvas>` de preview, convertir pixel → points PDF avec le ratio `pageWidth_pts / canvas.offsetWidth`)

---

## 4. Champs catégorie/sous-catégorie dans l'éditeur

### Fichier : `frontend/src/components/FacsimileTemplateEditor.tsx`

Dans la section "Informations du template" (vendor name, aliases…), ajouter :

```tsx
// Après les aliases chips
<div className="grid grid-cols-2 gap-3 mt-3">
  <div>
    <label className="text-xs text-gray-500 mb-1 block">Catégorie</label>
    <CategorySelect
      value={template.category ?? ""}
      onChange={(v) => updateTemplate({ category: v })}
    />
  </div>
  <div>
    <label className="text-xs text-gray-500 mb-1 block">Sous-catégorie</label>
    <SousCategorieSelect
      category={template.category ?? ""}
      value={template.sous_categorie ?? ""}
      onChange={(v) => updateTemplate({ sous_categorie: v })}
    />
  </div>
</div>
```

Utiliser les composants `CategorySelect` / `SousCategorieSelect` déjà présents dans le projet (OCR EditDrawer).

Ajouter `category` + `sous_categorie` au `PATCH /api/facsimile/templates/{id}` existant (acceptés dans le body, persistés dans `templates.json`).

---

## 5. Propagation lors de la génération batch

### Fichier : `backend/facsimile_service.py` — méthode `generate_facsimile()`

Après création du PDF fac-similé et écriture du `.ocr.json` avec `"source": "reconstitue"`, **si** `template.category` est défini :

```python
# Injecter les hints catégorie dans le .ocr.json généré
ocr_data = load_ocr_json(output_path)
if template.category:
    ocr_data["category_hint"] = template.category
if template.sous_categorie:
    ocr_data["sous_categorie_hint"] = template.sous_categorie
save_ocr_json(output_path, ocr_data)
```

Cela utilise le mécanisme de hints existant (`category_hint` / `sous_categorie_hint` top-level dans `.ocr.json`) déjà lu par `rapprochement_service.score_categorie()`.

---

## 6. Affichage dans la liste des templates

### Fichier : `frontend/src/pages/FacsimilePage.tsx` (ou composant TemplateCard)

Sur chaque carte de template, afficher :
- Badge `VIERGE` (amber) si `is_blank_template === true`
- Chips catégorie + sous-catégorie si renseignées (style pill gris clair, 11px)

```tsx
{template.is_blank_template && (
  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
    VIERGE
  </span>
)}
{template.category && (
  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
    {template.category}
    {template.sous_categorie && ` · ${template.sous_categorie}`}
  </span>
)}
```

---

## 7. Bouton "Créer depuis un PDF vierge" dans l'UI

### Fichier : `frontend/src/pages/FacsimilePage.tsx`

Dans le header de la page templates, à côté du bouton existant "Créer depuis un justificatif" :

```tsx
<button onClick={() => setShowBlankUploadDrawer(true)}
  className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
  <FilePlus2 size={15} />
  Depuis un PDF vierge
</button>
```

Ouvrir un drawer `BlankTemplateUploadDrawer` (400px) avec :
- Dropzone PDF unique
- Champ `vendor_name` (obligatoire)
- Champ `aliases` (chips, optionnel)  
- `CategorySelect` + `SousCategorieSelect` (optionnels)
- Bouton "Créer le template" → `POST /api/facsimile/templates/from-blank`
- Après succès : fermer le drawer, rafraîchir la liste, ouvrir automatiquement l'éditeur du template créé pour positionner les champs

---

## 8. Checklist de vérification

- [ ] `POST /api/facsimile/templates/from-blank` accepte le PDF, crée le template avec `is_blank_template=True`
- [ ] L'éditeur n'affiche pas "Détecter champs auto" pour un template vierge
- [ ] Clic sur aperçu PDF → coordonnées champ pré-remplies
- [ ] `category` + `sous_categorie` éditables sur tout template (vierge ou non)
- [ ] `PATCH /api/facsimile/templates/{id}` persiste `category` + `sous_categorie`
- [ ] Génération batch → `.ocr.json` contient `category_hint` + `sous_categorie_hint` si renseignés sur le template
- [ ] Badge VIERGE + chips catégorie visibles dans la liste
- [ ] Upload du fichier `template_repas_clinique_ELSAN.pdf` → template créé, champs `date` et `montant_ttc` positionnables manuellement
