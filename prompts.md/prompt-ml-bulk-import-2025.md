# ML — Bulk import training data depuis les opérations 2025 catégorisées

## Contexte

NeuronXcompta V3 — FastAPI + scikit-learn.

Les opérations bancaires 2025 sont stockées dans `data/imports/operations/*.json`, déjà manuellement catégorisées. Le modèle ML dispose actuellement de ~320 exemples dans `data/ml/model.json` (`training_data`). L'objectif est d'importer en bulk toutes les opérations 2025 valides comme données d'entraînement pour enrichir le corpus sklearn.

L'infrastructure d'auto-learning existe déjà dans `ml_service.py` :
- `clean_libelle(libelle)` — nettoie les libellés bancaires
- `add_training_examples_batch(examples)` — déduplique par `(libelle, categorie)` et append dans `training_data`
- `update_rules_from_operations(operations)` — met à jour `exact_matches` + `subcategories` dans `model.json`

## Analyse préalable (à faire AVANT tout patch)

### Étape 1 — Inventaire des données disponibles

Lire tous les fichiers `data/imports/operations/*.json` et calculer :
- Distribution des catégories sur toutes les ops avec `Catégorie` non vide / non "Autres" / non "Ventilé" / non "perso"
- Nombre d'exemples déjà dans `data/ml/model.json → training_data`
- Delta : nouveaux exemples potentiels (ops JSON non encore dans training_data)

Afficher le rapport complet avant de procéder.

### Étape 2 — Vérifier la structure des fichiers ops

Les fichiers JSON d'opérations ont cette structure :
```json
[
  {
    "Date": "2025-01-15",
    "Libellé": "VIREMENT SEPA CARMF",
    "Débit": 1200.00,
    "Crédit": 0,
    "Catégorie": "CARMF",
    "Sous-catégorie": "Cotisation",
    "Justificatif": false,
    "lettre": false,
    "locked": false
  }
]
```

Vérifier que les champs `Libellé`, `Catégorie`, `Sous-catégorie` sont bien présents.

## Implémentation

### Nouveau endpoint `POST /api/ml/import-from-operations`

Créer un endpoint dédié dans `backend/routers/ml.py` :

```python
@router.post("/import-from-operations")
async def import_from_operations(year: int = None):
    """
    Importe en bulk les opérations catégorisées comme training data.
    Réutilise l'infrastructure add_training_examples_batch() existante.
    """
    result = ml_service.import_training_from_operations(year=year)
    return result
```

### Nouvelle méthode `import_training_from_operations()` dans `ml_service.py`

```python
def import_training_from_operations(self, year: int = None) -> dict:
    """
    Scanne data/imports/operations/*.json et importe les ops catégorisées
    comme training examples. Réutilise clean_libelle() + add_training_examples_batch().
    """
    import glob
    
    EXCLUDED_CATEGORIES = {"", "Autres", "Ventilé", "perso", "Perso"}
    
    # Collecter tous les fichiers, filtrer par année si fournie
    pattern = "data/imports/operations/*.json"
    files = sorted(glob.glob(pattern))
    
    if year:
        # Filtrer via metadata year dans le nom de fichier ou contenu
        # Les fichiers sont nommés operations_merged_YYYYMM_*.json
        files = [f for f in files if f"_{year}" in f or f"_{str(year)[2:]}" in f]
    
    examples = []
    files_read = 0
    ops_scanned = 0
    ops_skipped = 0
    
    for filepath in files:
        try:
            ops = json.load(open(filepath, encoding="utf-8"))
            files_read += 1
            for op in ops:
                ops_scanned += 1
                libelle = op.get("Libellé", "").strip()
                categorie = op.get("Catégorie", "").strip()
                sous_categorie = op.get("Sous-catégorie", "").strip()
                
                if not libelle or categorie in EXCLUDED_CATEGORIES:
                    ops_skipped += 1
                    continue
                
                # Gérer les ventilations (lignes avec Catégorie="Ventilé")
                # → utiliser les sous-lignes si présentes
                ventilation_lines = op.get("ventilation_lines", [])
                if ventilation_lines:
                    for vl in ventilation_lines:
                        vl_cat = vl.get("categorie", "").strip()
                        vl_subcat = vl.get("sous_categorie", "").strip()
                        if vl_cat and vl_cat not in EXCLUDED_CATEGORIES:
                            examples.append({
                                "libelle": libelle,
                                "categorie": vl_cat,
                                "sous_categorie": vl_subcat,
                            })
                    continue
                
                examples.append({
                    "libelle": libelle,
                    "categorie": categorie,
                    "sous_categorie": sous_categorie,
                })
        except Exception as e:
            logger.warning(f"import_training: skip {filepath}: {e}")
    
    # Importer via l'infrastructure existante (déduplique automatiquement)
    added = self.add_training_examples_batch(examples)
    
    # Mettre à jour les règles exactes
    self.update_rules_from_operations([
        {"Libellé": ex["libelle"], "Catégorie": ex["categorie"], "Sous-catégorie": ex["sous_categorie"]}
        for ex in examples
    ])
    
    # Stats finales
    model = self._load_model()
    
    return {
        "success": True,
        "files_read": files_read,
        "ops_scanned": ops_scanned,
        "ops_skipped": ops_skipped,
        "examples_submitted": len(examples),
        "examples_added": added,  # nouveaux (dédupliqués)
        "total_training_data": len(model.get("training_data", [])),
        "year_filter": year,
    }
```

### Bouton UI dans AgentIAPage — ActionsRapides.tsx

Ajouter une nouvelle section "Importer données 2025" dans `frontend/src/components/agent-ia/ActionsRapides.tsx`, après la section "Entraîner + Appliquer" :

```tsx
{/* Import depuis opérations */}
<div className="space-y-3 pt-3 border-t border-border/30">
  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
    Importer données historiques
  </p>
  <p className="text-[11px] text-text-muted/70">
    Enrichit le corpus sklearn depuis les opérations déjà catégorisées.
  </p>
  
  <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
    <input
      type="checkbox"
      checked={importAllYears}
      onChange={(e) => setImportAllYears(e.target.checked)}
      className="rounded border-border"
    />
    Toutes les années {!importAllYears && <span className="text-text/60">({selectedYear})</span>}
  </label>

  <button
    onClick={() => importMutation.mutate()}
    disabled={importMutation.isPending}
    className="w-full bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center gap-2"
  >
    {importMutation.isPending ? (
      <><Loader2 size={14} className="animate-spin" /> Import en cours...</>
    ) : (
      <><Database size={14} /> Importer ops catégorisées</>
    )}
  </button>

  {importResult && (
    <div className="bg-background rounded-lg p-3 border border-blue-500/30 space-y-1 text-xs">
      <div className="flex items-center gap-1.5 mb-1">
        <CheckCircle size={14} className="text-blue-400" />
        <span className="font-medium text-blue-400">Import terminé</span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-text-muted">
        <span>Ops scannées</span><span className="text-text font-medium">{importResult.ops_scanned}</span>
        <span>Nouveaux exemples</span><span className="text-text font-medium">{importResult.examples_added}</span>
        <span>Total corpus</span><span className="text-text font-medium">{importResult.total_training_data}</span>
      </div>
    </div>
  )}
</div>
```

Ajouter la mutation correspondante dans le composant :

```tsx
const [importAllYears, setImportAllYears] = useState(false)
const [importResult, setImportResult] = useState<ImportResult | null>(null)

const importMutation = useMutation({
  mutationFn: () => {
    const qs = importAllYears ? '' : `?year=${selectedYear}`
    return api.post<ImportResult>(`/ml/import-from-operations${qs}`)
  },
  onSuccess: (data) => {
    setImportResult(data)
    toast.success(`${data.examples_added} nouveaux exemples importés (total: ${data.total_training_data})`)
    queryClient.invalidateQueries({ queryKey: ['ml-model'] })
    queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
    queryClient.invalidateQueries({ queryKey: ['ml-training-data'] })
  },
  onError: (error) => toast.error(`Erreur import: ${error.message}`),
})
```

### Type TypeScript à ajouter dans `frontend/src/types/index.ts`

```typescript
export interface ImportResult {
  success: boolean
  files_read: number
  ops_scanned: number
  ops_skipped: number
  examples_submitted: number
  examples_added: number
  total_training_data: number
  year_filter: number | null
}
```

Ajouter `Database` aux imports Lucide dans `ActionsRapides.tsx`.

## Workflow recommandé après implémentation

1. Cliquer "Importer ops catégorisées" (toutes années)
2. Vérifier le résultat : `examples_added` devrait être significatif (>200 si données 2025 complètes)
3. Cliquer "Entraîner + Appliquer" pour re-fitter sklearn sur le corpus enrichi
4. Observer l'accuracy_test dans le résultat — cible >50% avec corpus enrichi

## Contraintes

- `from __future__ import annotations` en tête des fichiers Python modifiés
- Réutiliser `clean_libelle()` + `add_training_examples_batch()` existants — pas de duplication
- La déduplication par `(libelle, categorie)` est gérée par `add_training_examples_batch()` — ne pas réimplémenter
- Ne jamais inclure catégories `perso`, `Autres`, `Ventilé`, vide dans le corpus sklearn
- Les ventilation_lines doivent être explosées individuellement (chaque sous-ligne = 1 exemple)
- Backward compatible : `add_training_examples_batch()` et `update_rules_from_operations()` ne sont pas modifiés
- Log du résultat dans `data/ml/logs/trainings.json` via `ml_monitoring_service` si disponible
