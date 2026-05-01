# Prompt Phase 2 — Livret comptable : chapitres restants (04→09)

> ⚠️ Session longue — bon moment pour commit + push avant de démarrer.
>
> **Lire `CLAUDE.md` à la racine du repo AVANT toute implémentation**, ainsi que les fichiers issus de la Phase 1 :
> - `backend/services/livret_service.py`
> - `backend/services/projection_service.py`
> - `backend/models/livret.py`
> - `frontend/src/components/livret/LivretChapterShell.tsx`
> - `frontend/src/components/livret/LivretOpsTable.tsx`
> - `frontend/src/types/livret.ts`

---

## 1 — Contexte

Phase 1 a posé les fondations du livret vivant et livré 3 chapitres pilotes (01 Synthèse · 02 Recettes · 03 Charges professionnelles). La Phase 2 complète les 6 chapitres restants en réutilisant le shell `LivretChapterShell`, le `LivretOpsTable` et l'agrégateur `livret_service.build_livret`.

**Aucun nouveau service principal** — extension de `livret_service` avec des composeurs de chapitre. Aucune donnée nouvelle n'est créée.

## 2 — Périmètre Phase 2

| # | Chapitre | Mode ventilation | Source principale |
|---|---|---|---|
| 04 | Charges forfaitaires | Groupé | `charges_forfaitaires_service` (blanchissage, repas) + poste GED véhicule |
| 05 | Charges sociales | Groupé | Operations URSSAF/CARMF/ODM + `fiscal_service.compute_urssaf_deductible` |
| 06 | Amortissements | Groupé | `amortissement_service.get_dotations(year)` + `get_registre()` |
| 07 | Provisions & coussin | Éclaté | Operations sous-cat `Provision IR`, `Provision Charges sociales`, `Coussin` |
| 08 | BNC — synthèse fiscale | Aucun (synthèse) | `bnc_service.compute_bnc(year)` + `fiscal_service.compute()` |
| 09 | Annexes | Aucun (méta) | Listing GED + barèmes JSON + statiques |

## 3 — Backend — extensions

### 3.1 — Modèles complémentaires

Ajouter à `backend/models/livret.py` :

```python
class LivretBncFormulaLine(BaseModel):
    label: str
    amount: float
    operator: Literal["plus", "minus", "equals"]
    note: Optional[str] = None

class LivretBncProjection(BaseModel):
    bnc_projete_annuel: float
    ir_estime: float
    urssaf_estime: float
    carmf_estime: float
    odm_estime: float
    total_charges_sociales_estime: float
    revenu_net_apres_charges: float

class LivretBncChapter(LivretChapter):
    formula: list[LivretBncFormulaLine]
    formula_comment: str
    projection: LivretBncProjection
    sources: dict[str, str]  # {"recettes": "liasse" | "bancaire", ...}

class LivretAmortissementImmo(BaseModel):
    nom: str
    poste: str
    valeur_origine: float
    date_acquisition: str
    duree_amortissement: int
    dotation_annuelle: float
    cumul_amortissement: float
    vnc: float
    is_backfill: bool = False

class LivretAmortissementsChapter(LivretChapter):
    immobilisations: list[LivretAmortissementImmo]
    total_dotations_annuelles: float

class LivretAnnexeBareme(BaseModel):
    nom: str           # ex: "URSSAF 2026"
    file: str
    last_updated: Optional[str] = None
    summary: dict       # contenu utile pour affichage

class LivretAnnexeChapter(LivretChapter):
    justificatifs_index: list[dict]
    baremes_appliques: list[LivretAnnexeBareme]
    glossaire: list[dict[str, str]]   # [{"term": "BNC", "definition": "..."}]
    methodologie: str                 # markdown bref
```

### 3.2 — Composeurs de chapitre dans `livret_service`

Découper en helpers privés. Chacun retourne un `LivretChapter` ou variante.

```python
def _build_chapter_04_forfaitaires(year, as_of):
    """Mode groupé. Sous-cat = Blanchissage, Repas, Véhicule.
    Source : OD générées par charges_forfaitaires_service (blanchissage, repas) +
    le poste GED 'véhicule' pour quote-part.
    Chaque opération virtuelle expose sa décomposition (jours, barème, articles)
    via libelle_meta + sub_lines (pour expansion UI)."""

def _build_chapter_05_sociales(year, as_of):
    """Mode groupé. Sous-cat = URSSAF, CARMF, ODM.
    Source : operations dont catégorie contient 'Cotisations' OR libellé matche
    URSSAF/DSPAMC/CARMF/ODM. Pour URSSAF, expose csg_non_deductible dans
    libelle_meta et sub_lines décomposition déductible/non-déductible."""

def _build_chapter_06_amortissements(year, as_of):
    """Mode groupé. Sous-cat = postes (Informatique, Mobilier, Véhicule, ...).
    Source : amortissement_service.get_registre() + get_dotations(year).
    immobilisations[] expose le détail par bien."""

def _build_chapter_07_provisions(year, as_of):
    """Mode éclaté. Sous-cat = Provision IR, Provision Charges sociales, Coussin.
    Source : operations dont sous_categorie est exactement l'une de ces 3 valeurs.
    Total YTD = somme des montants taggés provision (cumul des transferts vers
    le compte épargne fiscal)."""

def _build_chapter_08_bnc(year, as_of):
    """Pas de sous-catégories. formula expose 5-7 lignes :
        + Quote-part recettes SCP (ou bancaire si liasse non saisie)
        − Charges communes proportionnelles (si distinguables)
        − Charges personnelles déductibles
        − Dotations amortissements
        − Forfaits déductibles (blanchissage + repas)
        = BNC réalisé YTD
    projection consomme fiscal_service.compute() avec le BNC projeté annuel."""

def _build_chapter_09_annexes(year, as_of):
    """justificatifs_index : tous les .pdf liés à des ops via
    get_all_referenced_justificatifs(), avec ref op + sous-ligne le cas échéant.
    baremes_appliques : lit data/baremes/*_{year}.json et expose un summary par fichier.
    glossaire : statique (data/livret_glossaire.json à seedeer au lifespan).
    methodologie : statique markdown."""
```

Étendre `build_livret()` pour appeler les 6 nouveaux composeurs et les insérer dans `chapters` aux clés `"04"` → `"09"`.

### 3.3 — Pas de nouveau endpoint

Tous les chapitres remontent via `GET /api/livret/{year}` existant. Les modèles polymorphiques (`LivretBncChapter`, `LivretAmortissementsChapter`, `LivretAnnexeChapter` qui étendent `LivretChapter`) doivent être correctement sérialisés. Utiliser `model_dump(mode="json")` ; côté frontend, types TypeScript sous forme d'union discriminée par `number` (ex: `chapter.number === "08"` → cast en `LivretBncChapter`).

## 4 — Frontend

### 4.1 — Types

Étendre `frontend/src/types/livret.ts` avec les nouveaux modèles ci-dessus en miroir.

### 4.2 — Composants par chapitre

Tous dans `frontend/src/components/livret/` :

| Composant | Source des données | Particularités UI |
|---|---|---|
| `LivretForfaitairesChapter.tsx` | `chapters["04"]` | Mode groupé. Chaque op virtuelle dépliable montre la décomposition (jours, articles, barème) |
| `LivretSocialesChapter.tsx` | `chapters["05"]` | URSSAF row → badge `X € nd` (CSG non déductible) cliquable réutilisant le pattern `UrssafSplitWidget` existant si possible |
| `LivretAmortissementsChapter.tsx` | `chapters["06"]` | Tableau immobilisations 7 colonnes (nom, poste, val. origine, date, durée, dotation annuelle, VNC). Total dotations YTD en footer |
| `LivretProvisionsChapter.tsx` | `chapters["07"]` | 3 sous-cat side-by-side avec gauge cumul vs cible (cible = projection fiscale × 0.3 pour IR, etc.) |
| `LivretBncChapter.tsx` | `chapters["08"]` | Bloc formula style monospace + bloc projection 4 cards (BNC projeté, IR, Charges soc., Net) |
| `LivretAnnexesChapter.tsx` | `chapters["09"]` | 4 sous-sections accordion : Index justifs (paginé) / Barèmes / Glossaire / Méthodologie |

### 4.3 — `LivretPage` mise à jour

Insérer les 6 nouveaux chapitres dans l'ordre dans le rendu, après le chapitre 03 existant. Mettre à jour `LivretToc.tsx` pour que les clics scrollent correctement vers les nouveaux IDs.

### 4.4 — Filtres

Le toggle des filtres locaux (chips) reste actif sur les chapitres avec `LivretOpsTable` : 04, 05, 07. Les chapitres 06 (amortissements), 08 (BNC), 09 (annexes) ne sont pas concernés par les filtres. Le compteur `X / Y affichées` apparaît uniquement sur les chapitres impactés.

## 5 — Cas limites

- **Année où aucune OD forfaitaire générée** : chapitre 04 affiche "Aucune charge forfaitaire générée pour {year}" + bouton "Aller à Charges forfaitaires →" qui navigue vers `/charges-forfaitaires`.
- **Année avec liasse SCP non saisie** : chapitre 08 affiche un encadré ambre "Recettes calculées en base bancaire — saisir la liasse fiscale pour finaliser le BNC" avec bouton vers le drawer liasse.
- **Aucune immobilisation enregistrée** : chapitre 06 affiche "Aucune immobilisation enregistrée" + bouton vers `/amortissements`.
- **Provisions vides** (aucun transfert tagué) : chapitre 07 affiche les 3 sous-cat avec total = 0 et un encadré explicatif "Tagger les transferts depuis l'Editor en sous-catégorie Provision IR / Provision Charges sociales / Coussin".
- **Index justifs > 200 entrées** : pagination 50/page côté frontend, ou virtualization avec `react-window` si déjà utilisé ailleurs dans le projet.

## 6 — Vérifications manuelles

1. `/livret/2026` charge tous les 9 chapitres dans l'ordre.
2. Chapitre 04 expose les forfaits blanchissage et repas générés (vérifier sur une année où ils existent, ex 2024).
3. Chapitre 05 : une op URSSAF dépliée montre la part déductible vs non déductible.
4. Chapitre 06 : tableau immobilisations cohérent avec ce que montre `/amortissements`.
5. Chapitre 07 : somme des transferts taggés "Provision IR" = total affiché.
6. Chapitre 08 : la formule BNC retourne le même chiffre que le simulateur de `/simulation`.
7. Chapitre 09 : index justifs paginé si > 100 entrées ; barèmes affichent la version active de l'année.
8. Filtres locaux : "À revoir" filtre les ops du 05 et 07 sans toucher aux totaux des chapitres.

## 7 — Documentation finale

- `CLAUDE.md` : section Livret enrichie avec les 6 nouveaux chapitres (sources, modes, exclusions).
- `CHANGELOG.md` : `Added (YYYY-MM-DD): Livret Phase 2 — chapitres 04→09`.
- `api-reference.md` : la section `/api/livret` documente les nouveaux types polymorphes (`LivretBncChapter`, `LivretAmortissementsChapter`, `LivretAnnexeChapter`).

## 8 — Ordre d'implémentation

1. Modèles complémentaires.
2. Composeur 04 (le plus simple, source connue) → tester `curl`.
3. Composeur 05 (similaire au 02 en logique opérations).
4. Composeur 06 (lecture amortissement_service).
5. Composeur 07 (filtre sous-cat sur ops).
6. Composeur 08 (composition fiscal — réutiliser bnc_service).
7. Composeur 09 (statiques + index justifs).
8. Frontend : composant par chapitre dans le même ordre que ci-dessus.
9. Insertion dans `LivretPage` + mise à jour `LivretToc`.
10. Tests manuels.
11. Documentation.

Conventional Commits suggérés :

- `feat(livret): pydantic models for chapters 04 to 09`
- `feat(livret): chapter 04 forfaitaires composer`
- `feat(livret): chapter 05 sociales composer with CSG split`
- `feat(livret): chapter 06 amortissements composer`
- `feat(livret): chapter 07 provisions composer`
- `feat(livret): chapter 08 BNC fiscal composer with projection`
- `feat(livret): chapter 09 annexes composer`
- `feat(livret): frontend components for chapters 04 to 09`
- `docs(livret): CLAUDE.md + CHANGELOG + api-reference for phase 2`
