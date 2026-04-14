# Prompt Claude Code — Exemptions Justificatifs par Catégorie/Sous-catégorie

> Lis `CLAUDE.md` avant de commencer. Ordre strict : models → service utilitaire → migration settings → backend impacts → frontend Settings UI → vérification.

## Contexte

Actuellement, seule la catégorie "Perso" est exemptée de justificatif (hardcodé dans `_mark_perso_as_justified`). On veut généraliser : l'utilisateur configure dans Settings quelles catégories et sous-catégories n'exigent pas de justificatif. Cette config impacte la clôture, les alertes, le pipeline, l'auto-pointage.

## 1. Model — `backend/models/settings.py`

Ajouter au model `AppSettings` :

```python
class JustificatifExemptions(BaseModel):
    categories: list[str] = ["Perso"]
    sous_categories: dict[str, list[str]] = {}
    # sous_categories = { "Banque": ["Agios", "Frais bancaires"], "Cotisations": ["URSSAF", "CARMF"] }

# Dans AppSettings :
justificatif_exemptions: JustificatifExemptions = Field(default_factory=JustificatifExemptions)
```

Logique d'exemption :
- Si `categorie` est dans `exemptions.categories` → exemptée (toutes sous-catégories)
- Si `categorie` est dans `exemptions.sous_categories` ET `sous_categorie` est dans la liste → exemptée
- Sinon → justificatif requis

## 2. Service utilitaire — `backend/services/justificatif_exemption_service.py`

Nouveau fichier, très simple :

```python
from __future__ import annotations
from backend.services.settings_service import load_settings

def is_justificatif_required(categorie: str, sous_categorie: str = "") -> bool:
    """Retourne True si un justificatif est requis pour cette catégorie/sous-catégorie."""
    settings = load_settings()
    exemptions = settings.justificatif_exemptions
    
    if not categorie:
        return True  # ops non catégorisées : justificatif requis
    
    # Catégorie entière exemptée
    if categorie in exemptions.categories:
        return False
    
    # Sous-catégorie spécifique exemptée
    if categorie in exemptions.sous_categories:
        if sous_categorie in exemptions.sous_categories[categorie]:
            return False
    
    return True

def is_operation_justificatif_required(op: dict) -> bool:
    """Wrapper pour une opération (dict). Gère les ventilations."""
    cat = op.get("categorie", "")
    sous_cat = op.get("sous_categorie", "")
    return is_justificatif_required(cat, sous_cat)
```

## 3. Backend — Intégrer dans les services existants

### 3a. `backend/services/cloture_service.py`

Dans `get_annual_status()`, le calcul de `nb_justificatifs_total` et `nb_justificatifs_ok` doit exclure les opérations exemptées.

Trouver le code qui compte les justificatifs par mois. Modifier pour :

```python
from backend.services.justificatif_exemption_service import is_operation_justificatif_required

# Lors du comptage :
# - Si op ventilée : itérer les sous-lignes, chaque sous-ligne est évaluée individuellement
# - Si op non ventilée : évaluer l'op directement
# - Seules les ops où is_operation_justificatif_required() == True comptent dans nb_justificatifs_total
# - nb_justificatifs_ok = parmi celles-ci, celles qui ont un justificatif
```

### 3b. `backend/services/alerte_service.py` (ou le code qui génère les alertes)

Dans la détection `justificatif_manquant` : ne PAS générer d'alerte si `is_operation_justificatif_required(op)` retourne `False`.

Même logique pour les sous-lignes ventilées.

### 3c. `backend/services/operation_service.py`

Remplacer `_mark_perso_as_justified()` par une version généralisée `_mark_exempt_as_justified()` :

```python
from backend.services.justificatif_exemption_service import is_operation_justificatif_required

def _mark_exempt_as_justified(operations: list[dict]) -> list[dict]:
    """Auto-marque Justificatif=True pour les ops exemptées de justificatif."""
    for op in operations:
        if op.get("categorie") and not is_operation_justificatif_required(op):
            op["Justificatif"] = True
        # Ventilations : idem par sous-ligne
        for vl in op.get("ventilation", []):
            if vl.get("categorie") and not is_justificatif_required(vl.get("categorie", ""), vl.get("sous_categorie", "")):
                vl["justificatif"] = True  # ou le champ utilisé pour les sous-lignes
    return operations
```

Appeler `_mark_exempt_as_justified` partout où `_mark_perso_as_justified` était appelé. Supprimer l'ancienne fonction.

### 3d. Auto-pointage (`auto_lettre_complete`)

Vérifier que la logique d'auto-pointage considère les ops exemptées comme "justificatif OK" — normalement c'est déjà le cas si `_mark_exempt_as_justified` tourne avant, mais vérifier.

### 3e. Pipeline comptable (frontend seulement)

Le compteur "sans justificatif" de l'étape 3 utilise `taux_justificatifs` de clôture → déjà corrigé par 3a.

## 4. Frontend — Section Settings

### 4a. Types — `frontend/src/types/index.ts`

```typescript
interface JustificatifExemptions {
  categories: string[];
  sous_categories: Record<string, string[]>;
}

// Ajouter dans AppSettings :
justificatif_exemptions: JustificatifExemptions;
```

### 4b. Composant — `frontend/src/components/settings/JustificatifExemptionsSection.tsx`

Nouvelle section dans la page Settings, entre les sections existantes.

**Titre** : "Justificatifs requis" avec icône `FileCheck` (Lucide)

**Sous-titre** : "Décochez les catégories ou sous-catégories qui ne nécessitent pas de justificatif"

**Layout** : liste verticale des catégories (tirées de `GET /api/categories`), chaque catégorie expandable.

```
☑ Honoraires
  ☑ Gardes
  ☑ Astreintes
  ☑ Remplacements
☐ Perso                          ← décoché = exempté
☑ Banque
  ☑ Intérêts
  ☐ Agios                        ← sous-cat exemptée
  ☐ Frais bancaires              ← sous-cat exemptée
☑ Véhicule
  ☑ Carburant
  ☑ Entretien
...
```

**Comportement checkbox catégorie** :
- Décocher catégorie → ajoute dans `exemptions.categories`, toutes sous-cats suivent (grayed out)
- Cocher catégorie → retire de `exemptions.categories`, sous-cats redeviennent individuellement cochables
- État indéterminé (dash) si catégorie cochée mais certaines sous-cats décochées

**Comportement checkbox sous-catégorie** :
- Décocher → ajoute dans `exemptions.sous_categories[cat]`
- Cocher → retire de `exemptions.sous_categories[cat]`
- Désactivé (disabled + opacity) si catégorie parente est décochée

**Sauvegarde** : intégrée au `PUT /api/settings` existant, comme les autres sections Settings. Le bouton Save global de la page Settings envoie tout le `AppSettings`.

**Données** : utiliser `useCategories()` hook existant (ou `GET /api/categories`) pour lister catégories + sous-catégories.

**Style** :
- Container `bg-surface border border-border rounded-lg p-4`
- Checkboxes custom (même style que les autres toggles de l'app)
- Catégories en `font-medium text-text`, sous-catégories en `text-text-muted ml-6`
- Icône catégorie exemptée : petit badge `text-xs bg-warning/20 text-warning` "Exempté"

### 4c. Intégrer dans SettingsPage

Importer `JustificatifExemptionsSection` dans la page Settings existante. Le placer après la section thème/affichage, avant disk space.

Props : `exemptions` (valeur actuelle) + `onChange` (callback pour mettre à jour le state local avant save).

## 5. Vérification

- [ ] `settings.json` : le champ `justificatif_exemptions` apparaît avec default `{ categories: ["Perso"], sous_categories: {} }`
- [ ] Rétro-compatibilité : un `settings.json` existant sans ce champ charge le default (Pydantic le gère)
- [ ] Clôture `/api/cloture/2025` : les taux justificatifs excluent les ops exemptées
- [ ] Alertes `/api/alertes/summary` : pas de `justificatif_manquant` pour ops exemptées
- [ ] Settings UI : les catégories/sous-catégories s'affichent, checkbox toggle fonctionne, save persiste
- [ ] `_mark_perso_as_justified` supprimée, remplacée par `_mark_exempt_as_justified`
- [ ] Décocher "Banque > Agios" dans Settings → les agios n'apparaissent plus comme manquants dans Pipeline/Clôture
- [ ] Pas de régression sur l'auto-pointage
- [ ] TypeScript : zéro `any`, types stricts
