# Phase 1 — Base correcte : `_collect_referenced_justificatifs()` + exposition publique

## Objectif

Corriger la fonction qui collecte les justificatifs déjà référencés pour qu'elle couvre
les sous-lignes de ventilation, puis l'exposer en tant que fonction publique réutilisable.
Ce module est le prérequis de toutes les phases suivantes.

## Fichier cible

`backend/services/justificatif_service.py`

---

## 1. Corriger `_collect_referenced_justificatifs()`

### Problème actuel

La fonction itère les opérations mais ne descend probablement pas dans le champ
`ventilation` des opérations ventilées. Les sous-lignes ont chacune un champ
`justificatif` (nom de fichier) qui doit aussi être collecté.

### Structure JSON d'une opération ventilée (rappel)

```json
{
  "Date": "2025-03-15",
  "Libellé": "Achat fournitures",
  "Débit": 500.00,
  "Catégorie": "Ventilé",
  "Justificatif": true,
  "Lien justificatif": "",
  "ventilation": [
    {
      "montant": 300.00,
      "categorie": "Matériel",
      "sous_categorie": "Informatique",
      "libelle": "Écran",
      "justificatif": "amazon_20250315_300.00.pdf"
    },
    {
      "montant": 200.00,
      "categorie": "Véhicule",
      "sous_categorie": "Entretien",
      "libelle": "Courroie",
      "justificatif": ""
    }
  ]
}
```

### Règles métier pour la collecte

- **Opération normale** : collecter `op.get("Lien justificatif")` si non vide
- **Opération ventilée** : collecter `vl.get("justificatif")` pour chaque sous-ligne non vide
- **Ne pas** collecter `op.get("Justificatif")` (c'est un booléen, pas un nom de fichier)
- **Ne pas** collecter les chaînes vides ou `None`

### Implémentation corrigée

```python
def _collect_referenced_justificatifs() -> set[str]:
    """
    Collecte tous les noms de fichiers justificatifs déjà référencés
    dans les opérations (niveau opération + sous-lignes de ventilation).
    """
    referenced: set[str] = set()
    ops_dir = IMPORTS_OPERATIONS_DIR  # adapter au nom réel de la variable

    for ops_file in ops_dir.glob("operations_*.json"):
        try:
            operations = json.loads(ops_file.read_text(encoding="utf-8"))
            for op in operations:
                # Niveau opération
                lien = op.get("Lien justificatif", "")
                if lien:
                    referenced.add(lien)

                # Sous-lignes ventilées
                for vl in op.get("ventilation", []):
                    vl_justif = vl.get("justificatif", "")
                    if vl_justif:
                        referenced.add(vl_justif)
        except Exception:
            continue  # fichier corrompu → skip silencieux

    return referenced
```

> **Important** : vérifier dans le code existant le nom exact des variables
> `IMPORTS_OPERATIONS_DIR` (ou équivalent), le nom du champ dans les sous-lignes
> (`"justificatif"` vs `"Lien justificatif"` ou autre). Adapter en conséquence.

---

## 2. Exposer `get_all_referenced_justificatifs()` avec cache TTL

Ajouter **juste en dessous** de `_collect_referenced_justificatifs()` :

```python
import time as _time

_REF_CACHE: tuple[float, set[str]] | None = None
_REF_CACHE_TTL: float = 5.0  # secondes

def get_all_referenced_justificatifs() -> set[str]:
    """
    Version publique avec cache TTL 5s pour éviter de re-scanner à chaque requête.
    Invalider via invalidate_referenced_cache() après toute mutation.
    """
    global _REF_CACHE
    now = _time.time()
    if _REF_CACHE is not None and now - _REF_CACHE[0] < _REF_CACHE_TTL:
        return _REF_CACHE[1]
    result = _collect_referenced_justificatifs()
    _REF_CACHE = (now, result)
    return result


def invalidate_referenced_cache() -> None:
    """Invalider le cache après associate / dissociate / rename."""
    global _REF_CACHE
    _REF_CACHE = None
```

---

## 3. Appeler `invalidate_referenced_cache()` aux 4 points de mutation

Dans les fonctions existantes de `justificatif_service.py` :

| Fonction | Moment d'appel |
|---|---|
| `associate()` | Après le move + save opérations |
| `dissociate()` | Après le move + save opérations |
| `rename_justificatif()` | Après le rename (PDF + ops + GED) |
| `apply_link_repair()` | Après l'apply complet |

Ajouter `invalidate_referenced_cache()` à la fin de chacune de ces fonctions.

**Ne pas** l'appeler dans `_collect_referenced_justificatifs()` lui-même ni dans
`get_all_referenced_justificatifs()`.

---

## 4. Vérifier que `scan_link_issues()` n'est pas impacté

`scan_link_issues()` appelle `_collect_referenced_justificatifs()` en direct
(sans passer par le cache). C'est le comportement correct pour un scan complet
et frais — **ne pas modifier cet appel**.

---

## Checklist de vérification

- [ ] `get_all_referenced_justificatifs()` retourne un `set[str]` de noms de fichiers (pas de booléens)
- [ ] Un justificatif attaché à une sous-ligne ventilée est dans le set retourné
- [ ] Un justificatif attaché à une op normale est dans le set retourné
- [ ] Les chaînes vides / `None` ne sont pas dans le set
- [ ] `scan_link_issues()` continue d'appeler `_collect_referenced_justificatifs()` directement (pas de régression)
- [ ] Après `associate()`, le cache est invalidé (prochain appel re-scanne)
- [ ] Après `dissociate()`, le cache est invalidé
- [ ] Après `rename_justificatif()`, le cache est invalidé
- [ ] Importer `time` si pas déjà présent en haut du fichier
- [ ] Mettre à jour `CLAUDE.md` : section justificatif_service, noter `get_all_referenced_justificatifs()` + `invalidate_referenced_cache()`
