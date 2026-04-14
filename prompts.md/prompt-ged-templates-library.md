# GED — Vue bibliothèque des templates fac-similé

> Lis CLAUDE.md avant de commencer.  
> Prérequis : prompt `prompt-facsimile-template-scratch-categories.md` implémenté
> (champs `category`, `sous_categorie`, `is_blank_template` présents sur `FacsimileTemplate`).

## Objectif

Ajouter dans la GED un axe **"Templates"** qui liste et permet d'administrer
les templates fac-similé directement depuis la GED, sans quitter le module.

---

## 1. Endpoint — liste des templates enrichie pour la GED

### Fichier : `backend/routers/facsimile.py`

Ajouter :

```
GET /api/facsimile/templates/ged-summary
```

Retourne une liste de `GedTemplateItem` :

```python
class GedTemplateItem(BaseModel):
    id: str
    vendor_name: str
    aliases: list[str]
    category: Optional[str]
    sous_categorie: Optional[str]
    is_blank_template: bool
    fields_count: int              # len(template.fields)
    thumbnail_url: Optional[str]   # /api/facsimile/templates/{id}/thumbnail
    created_at: Optional[str]
    updated_at: Optional[str]
    facsimiles_generated: int      # nb de fichiers reconstitue_ associés à ce template
```

`facsimiles_generated` : compter les `.ocr.json` dans `data/justificatifs/`
dont `source == "reconstitue"` et `template_id == id`.

---

## 2. Navigation GED — nouvel axe "Templates"

### Fichier : `frontend/src/pages/GedPage.tsx`

Dans le sélecteur d'axe de navigation (par période / catégorie / fournisseur / type),
ajouter un cinquième axe :

```tsx
{ key: 'templates', label: 'Templates', icon: <Layers size={14} /> }
```

Visible uniquement quand au moins 1 template existe (sinon masqué pour ne pas
polluer la GED d'un utilisateur qui n'utilise pas les fac-similés).

---

## 3. Vue templates dans la GED

### Fichier : `frontend/src/components/ged/GedTemplatesView.tsx` (nouveau)

Affiché quand l'axe "Templates" est actif. Layout en deux colonnes :

**Colonne gauche — filtres (même style que les autres axes GED) :**
- Tous les templates
- Par catégorie (groupes dynamiques depuis les catégories distinctes des templates)
- Badge VIERGE / Depuis justificatif

**Colonne droite — grille de cards :**

Chaque card affiche :
- Thumbnail du template (PNG via `/api/facsimile/templates/{id}/thumbnail`)
- `vendor_name` en titre (13px, font-medium)
- Chips : catégorie · sous-catégorie (si renseignées)
- Badge `VIERGE` amber si `is_blank_template`
- Ligne de méta : `{fields_count} champs` · `{facsimiles_generated} générés`
- Deux boutons en bas de card :
  - `Éditer` (Pencil, 14px) → navigue vers `/facsimile?template={id}` (ouvre l'éditeur)
  - `Générer` (Wand2, 14px) → ouvre le `BatchGenerationDrawer` existant pré-filtré sur ce template

**Actions inline sur la card (hover) :**
- Modifier `category` / `sous_categorie` directement via un mini popover
  (CategorySelect + SousCategorieSelect) → `PATCH /api/facsimile/templates/{id}`
- Supprimer le template (icône Trash2, confirmation requise)

---

## 4. Panneau détail template (drawer GED)

Quand on clique sur une card (hors boutons), ouvrir un drawer 600px
`GedTemplateDetailDrawer` avec :

**Section "Informations"**
- Vendor name éditable inline
- Aliases chips éditables
- Category + sous-catégorie (dropdowns)
- Badge is_blank_template (non éditable, informatif)
- Dates créé/modifié

**Section "Champs variables"**
- Tableau readonly : label · type · position (x, y) · taille
- Bouton "Ouvrir l'éditeur complet" → `/facsimile?template={id}`

**Section "Fac-similés générés"**
- Liste des `facsimiles_generated` derniers fichiers générés depuis ce template
  (nom fichier, date, montant si extrait du nom)
- Chaque ligne cliquable → ouvre le GED drawer du justificatif correspondant

**Footer du drawer :**
- Bouton "Générer en batch" → `BatchGenerationDrawer`
- Bouton "Supprimer le template" (destructif, confirmation)

---

## 5. Lien retour GED depuis l'éditeur fac-similé

### Fichier : `frontend/src/pages/FacsimilePage.tsx`

Si l'URL contient `?from=ged`, afficher un breadcrumb en haut :
```
← GED · Templates
```
qui renvoie vers `/ged?axis=templates`.

Le bouton "Éditer" de la GedTemplatesView passe `?template={id}&from=ged`.

---

## 6. Checklist de vérification

- [ ] Axe "Templates" visible dans la GED quand ≥ 1 template existe
- [ ] Grille de cards avec thumbnails, chips catégorie, badge VIERGE
- [ ] Clic "Éditer" → éditeur fac-similé avec breadcrumb retour GED
- [ ] Clic "Générer" → BatchGenerationDrawer pré-filtré
- [ ] Drawer détail : champs readonly + liste fac-similés générés cliquables
- [ ] Modification catégorie/sous-catégorie inline depuis la GED persistée
- [ ] Suppression template avec confirmation
- [ ] `facsimiles_generated` compte correct
