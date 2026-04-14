# Prompt Claude Code — Entraîner + Appliquer (bulk recatégorisation)

> Lis d'abord `CLAUDE.md` pour le contexte projet.

## Objectif

Ajouter un bouton **"Entraîner + Appliquer"** dans la page Agent IA (`/agent-ai`) qui, en un seul clic :
1. Entraîne le modèle sklearn (`POST /api/ml/train`)
2. Recatégorise en mode `empty_only` toutes les opérations de l'année sélectionnée (ou toutes les années)

Le mode `empty_only` ne touche que les opérations sans catégorie ou en "Autres" — les corrections manuelles sont préservées.

---

## Ordre d'implémentation

### 1. Backend — Nouveau endpoint

**Fichier : `backend/routers/ml.py`**

Ajouter :

```python
@router.post("/train-and-apply")
async def train_and_apply(year: Optional[int] = None) -> dict:
```

**Logique :**
1. Appeler `ml_service.train_model()` (existant)
2. Lister les fichiers d'opérations via `operation_service.list_operation_files()`
3. Filtrer par `year` si fourni (champ `year` dans les métadonnées du fichier)
4. Pour chaque fichier, appeler `operation_service.categorize_operations(filename, mode="empty_only")` (logique existante dans le router operations — à extraire en service si pas déjà fait)
5. Compter : `files_processed`, `operations_updated` (nombre d'opérations qui ont changé de catégorie)

**Réponse :**
```json
{
  "training": {
    "success": true,
    "examples_count": 340,
    "accuracy": 0.87
  },
  "apply": {
    "files_processed": 12,
    "operations_updated": 47,
    "year_filter": 2026
  }
}
```

**Attention :**
- Utiliser `from __future__ import annotations` 
- `Optional[int]` pas `int | None`
- La logique de catégorisation (`categorize_operations`) est dans `backend/routers/operations.py` dans le handler `POST /{filename}/categorize`. Si elle n'est pas déjà dans `operation_service.py`, l'extraire en méthode de service `categorize_file(filename: str, mode: str) -> dict` pour pouvoir l'appeler depuis le router ml aussi. Ne pas dupliquer la logique.

### 2. Backend — Extraction logique catégorisation (si nécessaire)

**Fichier : `backend/services/operation_service.py`**

Vérifier si la logique de catégorisation (appel `ml_service.predict_category` + `predict_subcategory` sur chaque opération) est déjà dans un service. Si elle est inline dans le router operations, l'extraire :

```python
def categorize_file(filename: str, mode: str = "empty_only") -> dict:
    """Catégorise les opérations d'un fichier.
    
    Args:
        filename: nom du fichier d'opérations
        mode: "empty_only" (défaut) ou "all"
    
    Returns:
        {"total": int, "categorized": int, "unchanged": int}
    """
```

Puis mettre à jour le router operations pour appeler cette méthode.

### 3. Frontend — Hook

**Fichier : `frontend/src/hooks/useApi.ts`**

Ajouter une mutation :

```typescript
export function useTrainAndApply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year?: number) =>
      api.post('/ml/train-and-apply', null, { params: year ? { year } : {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-model'] });
      queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
  });
}
```

### 4. Frontend — Interface

**Fichier : `frontend/src/components/agent-ia/AgentIAPage.tsx`** (ou le composant équivalent)

Ajouter un bouton à côté du bouton "Entraîner" existant :

- Icône : `BrainCircuit` (Lucide) ou `Zap`
- Label : **"Entraîner + Appliquer"**
- Style : `bg-green-600 hover:bg-green-700` pour le différencier du train simple
- Au clic :
  - Utiliser l'année du store Zustand global (`useFiscalYearStore`) comme paramètre `year`
  - `toast.loading("Entraînement + recatégorisation en cours...")`
  - Sur succès : `toast.success("Modèle entraîné. {operations_updated} opérations recatégorisées sur {files_processed} fichiers.")`
  - Sur erreur : `toast.error("Erreur : ...")`
- État loading : désactiver le bouton + spinner

**Option "Toutes les années"** : ajouter un petit toggle ou checkbox sous le bouton :
- `☐ Toutes les années` — si coché, ne pas envoyer le param `year` (traite tous les fichiers)
- Par défaut décoché = année du store Zustand

---

## Checklist de vérification

- [ ] `from __future__ import annotations` dans tout fichier Python modifié
- [ ] La logique de catégorisation n'est PAS dupliquée — une seule source de vérité dans le service
- [ ] Le mode `empty_only` préserve les catégories existantes (≠ "Autres" et ≠ vide)
- [ ] Le bouton utilise `useFiscalYearStore` pour l'année par défaut
- [ ] `queryClient.invalidateQueries` invalide à la fois `ml-model` et `operations`
- [ ] Toast avec stats concrètes (nb fichiers, nb opérations modifiées)
- [ ] Le bouton "Entraîner" existant reste inchangé (pour ceux qui veulent juste entraîner sans appliquer)
- [ ] Pas de `any` TypeScript
- [ ] Tester : corriger 5 opérations dans l'éditeur → sauvegarder → cliquer "Entraîner + Appliquer" → vérifier que les anciennes opérations vides sont remplies
