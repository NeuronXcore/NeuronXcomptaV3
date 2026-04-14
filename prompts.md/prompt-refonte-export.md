# Prompt Claude Code — Refonte Export Comptable

> Lire `CLAUDE.md` en premier. Ce prompt refond le module Export Comptable (CSV + PDF) avec des règles comptables strictes, un meilleur nommage et un PDF professionnel avec logo.

---

## Contexte

L'export comptable actuel a plusieurs problèmes :
1. **CSV** : séparateur `,` au lieu de `;`, montants inconsistants (entiers/décimaux), en-têtes commentées `#`, colonne justificatif = "Oui/Non" au lieu du nom de fichier, pas de ligne totaux exploitable, mélange CRLF/LF
2. **PDF** : pas de ligne totaux en dernière ligne, pas de logo, colonne justificatif = "Oui" au lieu du nom PDF, pas de pagination, montants non alignés à droite
3. **Règles comptables** : les opérations catégorisées "perso" sont incluses dans les totaux BNC (faux), les opérations sans catégorie ne sont pas signalées comme compte d'attente

---

## Règles comptables à implémenter

### Exclusion "perso"
- Les opérations avec `categorie.lower() == "perso"` sont **exclues** des totaux recettes/dépenses BNC
- Elles restent visibles dans l'export (pour traçabilité bancaire) mais dans une section séparée "Mouvements personnels"
- Leurs montants ne rentrent dans aucun total comptable

### Compte d'attente
- Les opérations avec catégorie vide (`""`, `null`, `None`) ou `"Autres"` sont considérées **en attente de ventilation**
- Elles sont listées dans une section séparée "Compte d'attente" 
- Leurs montants apparaissent dans un total séparé "Montant en attente de ventilation" (pas dans le BNC)

### Ventilation
- Si une opération a un champ `ventilation: [...]` non vide, les sous-lignes remplacent l'opération parente dans l'export
- Chaque sous-ligne a sa propre catégorie, sous-catégorie, montant et justificatif
- La ligne parente (catégorie "Ventilé") n'apparaît PAS dans les totaux

### Structure des totaux (en bas du CSV et du PDF)
```
Total Recettes professionnelles :  XX XXX,XX €
Total Charges professionnelles :   XX XXX,XX €
Solde BNC :                        XX XXX,XX €
---
Mouvements personnels exclus :     XX XXX,XX € (N opérations)
Compte d'attente :                 XX XXX,XX € (N opérations)
```

---

## 1. Backend — `backend/services/export_service.py`

### Nouvelle fonction de tri/filtrage

```python
def _prepare_export_operations(operations: list[dict], filename: str) -> dict:
    """
    Prépare les opérations pour l'export en les classant en 3 groupes.
    Explose les ventilations. Trie par date ASC.
    
    Returns:
        {
            "pro": [...],           # Opérations professionnelles (BNC)
            "perso": [...],         # Opérations personnelles (exclues du BNC)
            "attente": [...],       # Opérations non catégorisées (compte d'attente)
            "totals": {
                "recettes_pro": float,
                "charges_pro": float,
                "solde_bnc": float,
                "total_perso": float,
                "nb_perso": int,
                "total_attente": float,
                "nb_attente": int,
            }
        }
    """
```

Logique :
- Itérer les opérations
- Si `ventilation` non vide → exploser en sous-lignes (chacune hérite de `date`, `libelle` parent + suffixe ` [V1/N]`)
- Classer chaque ligne (ou sous-ligne) :
  - `categorie.strip().lower() == "perso"` → groupe `perso`
  - `categorie.strip() == ""` ou `categorie is None` ou `categorie == "Autres"` ou `categorie == "Ventilé"` (sans sous-lignes) → groupe `attente`
  - Tout le reste → groupe `pro`
- Trier chaque groupe par `date` ASC
- Calculer les totaux par groupe :
  - `recettes_pro` = sum(credit) des ops `pro`
  - `charges_pro` = sum(debit) des ops `pro`
  - `solde_bnc` = recettes_pro - charges_pro
  - `total_perso` = sum(debit + credit) des ops `perso`
  - `total_attente` = sum(debit + credit) des ops `attente`

### Colonne Justificatif

Le champ `Lien justificatif` ou `justificatif` de chaque opération contient soit un chemin (`traites/xxx.pdf`), soit un nom de fichier, soit vide. Dans l'export :
- Si non vide → extraire le basename (`xxx.pdf`) via `os.path.basename()` ou `.split('/')[-1]`
- Si vide → laisser vide (pas "Non")

Pour les sous-lignes ventilées, le champ justificatif est dans `ventilation[i].justificatif`.

---

## 2. Backend — Génération CSV

Fichier : `backend/services/export_service.py` (fonction existante de génération CSV)

### Format cible

```csv
Date;Libellé;Débit;Crédit;Catégorie;Sous-catégorie;Justificatif;Commentaire
2025-01-06;VIRSEPARECU/FRMSCPANESTHESIOLO/EID 3000,00;0,00;3 000,00;Honoraires;Bloc;;
...
;;23 064,87;34 928,83;;;;TOTAL PROFESSIONNEL
;;;;;;; 
;;1 234,56;5 678,90;;;;MOUVEMENTS PERSONNELS EXCLUS (12 opérations)
;;456,78;0,00;;;;COMPTE D'ATTENTE (3 opérations)
```

### Règles CSV

1. **Séparateur** : `;`
2. **Encodage** : UTF-8 BOM (`\ufeff` en tête) + CRLF partout
3. **Pas de lignes commentées** `#` — le CSV commence directement par le header
4. **Montants** : toujours 2 décimales, virgule décimale, espace comme séparateur de milliers (`1 234,56`)
5. **Colonne Justificatif** : nom du fichier PDF ou vide
6. **Section professionnelle** d'abord (triée par date), puis ligne vide, puis ligne totaux pro, puis ligne vide, puis perso avec total, puis attente avec total
7. **Ligne totaux pro** : cellules Date et Libellé vides, Débit = total charges pro, Crédit = total recettes pro, Catégorie vide, Sous-catégorie vide, Justificatif vide, Commentaire = `TOTAL PROFESSIONNEL`
8. **Pas de quoting sauf si le champ contient un `;`** (les montants dans les libellés contiennent des `,` — pas de problème avec séparateur `;`)

### Helper formatage montant FR

```python
def _format_amount_fr(amount: float) -> str:
    """1234.56 → '1 234,56', 0 → '0,00'"""
    if amount == 0:
        return "0,00"
    formatted = f"{amount:,.2f}"  # "1,234.56"
    # swap: , → TEMP, . → , TEMP → espace
    formatted = formatted.replace(",", " ").replace(".", ",")
    return formatted
```

---

## 3. Backend — Génération PDF

Fichier : `backend/services/export_service.py` (fonction existante de génération PDF via ReportLab)

### Logo

- Le logo de l'app existe (ou sera placé) dans `frontend/public/logo-light.png`
- Copier le logo dans `backend/static/logo-light.png` (créer le dossier `backend/static/` si nécessaire)
- Au moment de la génération PDF, charger le logo via `ReportLab Image` en haut à gauche
- Dimensions logo : largeur 120pt, hauteur proportionnelle
- **Si le fichier logo n'existe pas**, ne pas crasher — simplement ne pas afficher de logo (graceful fallback)

### Structure du PDF

```
┌──────────────────────────────────────────────────┐
│ [LOGO]              Export Comptable              │
│                     Janvier 2025                  │
│                Généré le 06/04/2026               │
├──────────────────────────────────────────────────┤
│ OPÉRATIONS PROFESSIONNELLES                      │
├─────┬──────────────┬────────┬────────┬─────┬─────┤
│Date │ Libellé      │  Débit │ Crédit │ Cat │Just.│
├─────┼──────────────┼────────┼────────┼─────┼─────┤
│ ... │ ...          │   0,00 │ 3000,00│ ... │ ... │
├─────┴──────────────┼────────┼────────┼─────┴─────┤
│ TOTAL PRO          │23064,87│34928,83│           │
├────────────────────┴────────┴────────┴───────────┤
│ MOUVEMENTS PERSONNELS EXCLUS (12 ops)            │
├─────┬──────────────┬────────┬────────┬─────┬─────┤
│ ... │ ...          │   0,00 │   2,39 │perso│     │
├─────┴──────────────┼────────┼────────┼─────┴─────┤
│ TOTAL PERSO        │  XX,XX │  XX,XX │           │
├────────────────────┴────────┴────────┴───────────┤
│ COMPTE D'ATTENTE (3 ops)                         │
├─────┬──────────────┬────────┬────────┬─────┬─────┤
│ ... │ ...          │ 399,00 │   0,00 │     │     │
├─────┴──────────────┼────────┼────────┼─────┴─────┤
│ TOTAL ATTENTE      │ 399,00 │   0,00 │           │
├────────────────────┴────────┴────────┴───────────┤
│                    RÉCAPITULATIF                   │
│ Recettes professionnelles :        34 928,83 €    │
│ Charges professionnelles :         23 064,87 €    │
│ Solde BNC :                        11 863,96 €    │
│ Mouvements personnels exclus :      XX XXX,XX €   │
│ En attente de ventilation :            XXX,XX €   │
├──────────────────────────────────────────────────┤
│ Page 1/3          NeuronXcompta — Janvier 2025    │
└──────────────────────────────────────────────────┘
```

### Règles PDF

1. **Orientation** : paysage (A4 landscape) pour avoir la place des 7 colonnes
2. **Colonnes** : Date (70pt), Libellé (flex/restant), Débit (80pt, aligné droite), Crédit (80pt, aligné droite), Catégorie (80pt), Sous-cat (70pt), Justificatif (100pt)
3. **Montants alignés à droite** avec format FR (`1 234,56 €`)
4. **Lignes totaux** : fond gris clair `#E8E8E8`, texte bold
5. **Section headers** ("OPÉRATIONS PROFESSIONNELLES", "MOUVEMENTS PERSONNELS EXCLUS", "COMPTE D'ATTENTE") : fond bleu-gris `#D5E8F0`, texte bold, full width
6. **Récapitulatif** : bloc en bas de la dernière page, fond léger, montants alignés
7. **Footer** : `Page X/Y` à gauche, `NeuronXcompta — {Mois} {Année}` à droite, séparateur fin
8. **Police** : Helvetica 8pt pour le tableau, 10pt pour les headers
9. **Alternance de couleurs** : lignes paires `#F8F8F8`, impaires blanc

---

## 4. Nommage des fichiers d'export

### Convention actuelle (à changer)
`operations_Janvier_2025.csv` / `operations_Janvier_2025.pdf`

### Nouvelle convention
`Export_Comptable_2025-01_Janvier.{csv,pdf}`

Format : `Export_Comptable_{YYYY}-{MM}_{MoisFR}.{ext}`

Le nommage doit être généré dans la fonction d'export via :
```python
def _export_filename(year: int, month: int, ext: str) -> str:
    from backend.core.config import MOIS_FR
    mois_label = MOIS_FR.get(month, f"{month:02d}")
    return f"Export_Comptable_{year}-{month:02d}_{mois_label}.{ext}"
```

Mettre à jour aussi le nom dans le ZIP d'export (si les fichiers sont dans un ZIP).

---

## 5. Fichiers à modifier

| Fichier | Modifications |
|---------|---------------|
| `backend/services/export_service.py` | `_prepare_export_operations()`, refonte CSV (`;`, format FR, sections, totaux), refonte PDF (logo, sections, totaux, footer, paysage), `_export_filename()`, `_format_amount_fr()` |
| `backend/routers/exports.py` | Aucun changement d'API prévu — les endpoints restent identiques, seul le contenu généré change |
| `backend/static/logo-light.png` | Créer le dossier et placer le logo (ou documenter qu'il faut le placer manuellement) |

---

## 6. Ordre d'implémentation

1. Créer `backend/static/` et y copier le logo si disponible (sinon créer un placeholder ou un fallback)
2. Ajouter `_format_amount_fr()` dans `export_service.py`
3. Ajouter `_export_filename()` dans `export_service.py`
4. Implémenter `_prepare_export_operations()` avec les 3 groupes + totaux + explosion ventilation
5. Refondre la génération CSV avec les nouvelles règles
6. Refondre la génération PDF avec les nouvelles règles (logo, sections, totaux, pagination, paysage)
7. Mettre à jour les appels dans le router/service pour utiliser `_export_filename()`
8. Tester manuellement : importer un relevé avec des ops perso + non catégorisées + ventilées → vérifier CSV + PDF

---

## 7. Checklist de vérification

- [ ] CSV s'ouvre proprement dans Excel FR (séparateur `;` détecté, montants en colonnes numériques)
- [ ] CSV : pas de lignes `#` commentées
- [ ] CSV : montants toujours 2 décimales avec virgule (`1 234,56`)
- [ ] CSV : colonne Justificatif = nom du fichier PDF ou vide (jamais "Oui"/"Non")
- [ ] CSV : ligne totaux pro en bas des ops pro, exploitable
- [ ] CSV : ops perso dans section séparée avec total
- [ ] CSV : ops non catégorisées dans section séparée avec total
- [ ] CSV : ventilations explosées en sous-lignes
- [ ] PDF : logo en haut à gauche (ou graceful fallback si absent)
- [ ] PDF : orientation paysage A4
- [ ] PDF : montants alignés à droite, format FR
- [ ] PDF : 3 sections visuellement distinctes (pro / perso / attente)
- [ ] PDF : ligne totaux pro en bold fond gris
- [ ] PDF : récapitulatif BNC en bas
- [ ] PDF : footer avec pagination `Page X/Y` + nom app + période
- [ ] PDF : alternance couleurs lignes paires/impaires
- [ ] Nommage : `Export_Comptable_2025-01_Janvier.{csv,pdf}`
- [ ] Totaux BNC excluent les ops perso ET les ops non catégorisées
- [ ] Pas de crash si le logo est absent
- [ ] Pas de crash si toutes les ops sont perso (totaux pro = 0)
- [ ] Pas de crash si aucune op n'est non catégorisée (section attente absente ou vide)
