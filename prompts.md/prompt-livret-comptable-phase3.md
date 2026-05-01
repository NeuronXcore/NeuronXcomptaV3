# Prompt Phase 3 — Livret comptable : snapshots + exports HTML/PDF + page Archives

> ⚠️ Session longue — bon moment pour commit + push avant de démarrer.
>
> **Lire `CLAUDE.md` à la racine du repo AVANT toute implémentation**, ainsi que :
> - `backend/services/livret_service.py` (Phase 1+2)
> - `backend/models/livret.py`
> - `frontend/src/components/livret/LivretPage.tsx`
> - Patterns existants à inspirer/réutiliser :
>   - `backend/services/category_snapshot_service.py` — référence pour PDF + enregistrement GED
>   - `backend/templates/email_template.html` — référence pour Jinja2 + CID embedded
>   - `backend/services/scheduler_service.py` (ou équivalent) — APScheduler déjà en place pour Prévisionnel

---

## 1 — Contexte

Le livret est désormais une vue live complète (Phase 1+2). Phase 3 lui donne sa dimension archivable : des **instantanés figés** générés automatiquement (1er du mois + à la clôture) et manuellement (bouton "Figer instantané"), exportables en HTML autonome et en PDF paginé.

Caractéristiques :

- **HTML autonome** : un seul fichier `.html` autoporté (CSS + JS + données JSON inline). Consultable hors ligne dans n'importe quel navigateur. Filtres locaux, expand/collapse opérations, sommaire cliquable — sans aucun fetch.
- **PDF paginé** : ReportLab A4, sommaire avec ancres, en-têtes/pieds, page de garde.
- **Stockage local** : `data/livret_snapshots/{year}/` + `manifest.json` + sauvegarde GED.

## 2 — Périmètre Phase 3

- Service `snapshot_service.py` : CRUD snapshots + manifest (lock fichier).
- Service `livret_html_generator.py` : Jinja2 template autonome.
- Service `livret_pdf_generator.py` : ReportLab paginé.
- Job APScheduler mensuel (1er du mois 02:00) → snapshot auto.
- Hook lifecycle clôture (étendre `cloture_service` existant) → snapshot auto type "cloture".
- Endpoints `/api/livret/snapshots/...`
- Frontend : bouton "Figer instantané" actif, page `/livret/:year/archives` + hooks.

## 3 — Architecture

```
GET    /api/livret/snapshots                       → liste filtrable
POST   /api/livret/snapshots/{year}                → création manuelle (type="manual")
GET    /api/livret/snapshots/{snapshot_id}         → métadonnées
GET    /api/livret/snapshots/{snapshot_id}/html    → fichier HTML autonome (inline par défaut)
GET    /api/livret/snapshots/{snapshot_id}/pdf     → fichier PDF (inline par défaut)
DELETE /api/livret/snapshots/{snapshot_id}         → suppression (garde sur "cloture")

Triggers :
  ├─ APScheduler cron 1er du mois 02:00 → type="auto_monthly"
  ├─ cloture_service.cloture_exercise(year) → type="cloture" (final)
  └─ POST manuel → type="manual"
```

**Important — servir inline par défaut** : les endpoints `/html` et `/pdf` retournent les fichiers avec `Content-Disposition: inline; filename="..."` par défaut. Les iframe et `<embed>` peuvent ainsi les charger directement pour la consultation in-app. Le téléchargement forcé se fait côté frontend (fetch + blob URL + lien `download`) plutôt que via un paramètre serveur — pattern plus propre.

**Stockage** :

```
data/livret_snapshots/
  ├─ manifest.json
  ├─ manifest.json.bak
  └─ 2026/
      ├─ 2026-04-01_auto_monthly.html
      ├─ 2026-04-01_auto_monthly.pdf
      ├─ 2026-04-12_manual.html
      ├─ 2026-04-12_manual.pdf
      └─ ...
```

**Format `manifest.json`** :

```json
{
  "version": 1,
  "snapshots": [
    {
      "id": "2026_2026-04-01_auto_monthly",
      "year": 2026,
      "snapshot_date": "2026-04-01",
      "type": "auto_monthly",
      "trigger": "scheduler",
      "as_of_date": "2026-03-31",
      "html_filename": "2026-04-01_auto_monthly.html",
      "pdf_filename": "2026-04-01_auto_monthly.pdf",
      "html_size": 245680,
      "pdf_size": 412900,
      "comment": null,
      "data_sources": {"liasse_scp": false, "previsionnel": true},
      "ytd_metrics": {"recettes": 95430, "charges": 28710, "bnc": 66720}
    }
  ]
}
```

## 4 — Backend

### 4.1 — Modèles Pydantic

Ajouter à `backend/models/livret.py` :

```python
class SnapshotType(str, Enum):
    AUTO_MONTHLY = "auto_monthly"
    CLOTURE = "cloture"
    MANUAL = "manual"

class LivretSnapshotMetadata(BaseModel):
    id: str
    year: int
    snapshot_date: str       # ISO date
    type: SnapshotType
    trigger: Literal["scheduler", "cloture_hook", "manual_user"]
    as_of_date: str
    html_filename: str
    pdf_filename: str
    html_size: int
    pdf_size: int
    comment: Optional[str] = None
    data_sources: dict
    ytd_metrics: dict
    created_at: str
    ged_document_ids: dict   # {"html": "doc_xxx", "pdf": "doc_yyy"}

class CreateSnapshotRequest(BaseModel):
    snapshot_type: SnapshotType = SnapshotType.MANUAL
    as_of_date: Optional[str] = None  # default: yesterday
    comment: Optional[str] = None
```

### 4.2 — `snapshot_service.py`

Operations :

- `list_snapshots(year: Optional[int] = None) -> list[LivretSnapshotMetadata]` — filtré, trié par `snapshot_date` DESC.
- `get_snapshot(snapshot_id) -> LivretSnapshotMetadata` — 404 si absent.
- `create_snapshot(year, snapshot_type, comment=None, as_of_date=None) -> LivretSnapshotMetadata` :
  1. `as_of = as_of_date or yesterday()` — par défaut on fige sur la fin du jour précédent pour des données stables.
  2. `livret = livret_service.build_livret(year, as_of_date=as_of, snapshot_id=...)` — passer le `snapshot_id` pour que le livret sache qu'il est figé.
  3. `html = livret_html_generator.render(livret)` → écrit `2026/{date}_{type}.html`.
  4. `pdf_bytes = livret_pdf_generator.render(livret)` → écrit `2026/{date}_{type}.pdf`.
  5. Met à jour `manifest.json` (lock fichier via `fcntl.flock` ou similaire pour éviter race).
  6. Enregistre dans la GED comme `type: "rapport"`, `source_module: "livret"` (pattern miroir `category_snapshot_service`).
- `delete_snapshot(snapshot_id, force=False)` :
  - Refuse si `type == "cloture"` sauf `force=True` (HTTP 423).
  - Supprime les 2 fichiers + entrée manifest + entrées GED.

**Format ID** : `{year}_{snapshot_date}_{type}`. Si conflit (ex: 2 snapshots manuels le même jour), suffixe `_{HHMMSS}`.

**Lock manifest** : sauvegarde `manifest.json.bak` à chaque écriture réussie. En lecture, fallback sur `.bak` si le primaire est invalide JSON.

**Cleanup défensif** : si une création échoue après écriture partielle (HTML créé, PDF échoué), nettoyer les fichiers partiels avant de remonter l'erreur.

### 4.3 — `livret_html_generator.py`

**Approche** : un template Jinja2 `backend/templates/livret_template.html` qui :

- Inclut tout le CSS dark theme inline (extraire les variables CSS nécessaires depuis le frontend OU définir un set autonome propre — préférer la 2e option pour stabilité).
- Inclut un `<script>` avec les données du livret en JSON : `const LIVRET_DATA = {{ livret_json|safe }};`
- Inclut un `<script>` vanilla JS qui :
  - Filtre local sur les chips (Tout / À revoir / Justif manquant / Mixte / Verrouillé).
  - Expand/collapse des opérations avec ventilation.
  - Scroll vers le sommaire au clic d'une entrée TOC.
  - Compteur `X / Y affichées` quand un filtre est actif.
- N'inclut **aucune** balise `<script src="...">` ni `<link href="...">` externe — totalement autonome.
- Police système (sans-serif fallback) pour ne pas dépendre de fonts custom.

Le template doit produire **le même rendu visuel** que la `LivretPage` React mais en HTML statique. Pattern : suivre la structure du mockup HTML déjà validé en design (page de garde compacte en haut, toolbar simplifiée style "consultation", sommaire grid, chapitres dans l'ordre).

**Variables Jinja2 reçues** :

```python
{
  "livret": Livret,        # objet Pydantic dump (dict)
  "livret_json": str,       # même chose en JSON sérialisé pour injection JS
  "snapshot_meta": LivretSnapshotMetadata,
  "generated_at": "2026-04-01T02:00:00",
}
```

Le HTML doit afficher en haut : `Livret comptable {year} — Instantané du {date} ({type})` + un encadré discret "Document figé — non éditable".

**Cible taille** : < 1 MB pour une année moyenne. Si > 5 MB, mettre `large: true` dans le manifest mais accepter ; > 50 MB → erreur générateur 413.

### 4.4 — `livret_pdf_generator.py`

**Approche** : ReportLab A4 portrait, story building.

Structure :

1. **Page de garde** : logo `logo_lockup_light_400.png`, titre `Livret comptable — Exercice {year}`, sous-titre `Instantané du {date}`, période couverte, type (Auto mensuel / Clôture / Manuel).
2. **Sommaire** : table des chapitres avec n° de page (bookmark/anchor ReportLab).
3. **Chapitre par chapitre** :
   - 01 Synthèse : 4 metric cards en bloc + graphique cadence mensuelle (matplotlib → PNG inline via `ImageReader`).
   - 02 Recettes : sous-cat + tableau ops (max 100 lignes par sous-cat ; au-delà, indiquer "+ N opérations" et tronquer).
   - 03 Charges pro : idem en mode éclaté.
   - 04 Forfaitaires : ops virtuelles + décompositions.
   - 05 Sociales : ops + split CSG.
   - 06 Amortissements : tableau complet du registre.
   - 07 Provisions : 3 sous-cat.
   - 08 BNC : formule + projection 4 cards.
   - 09 Annexes : index justifs (max 200), barèmes (résumé), glossaire, méthodologie.
4. **Pied de page** sur toutes les pages : `Livret comptable {year} · Instantané {date} · Page X / Y` + numéro de page (utiliser `PageTemplate` + `onLaterPages`).
5. **En-tête** sur les pages de chapitre : numéro + titre du chapitre.

Cibler 30-60 pages selon volumétrie. Optimiser pour print (font 9-10 pt, marges 2 cm).

### 4.5 — Job APScheduler

Étendre le scheduler existant (lifespan FastAPI dans `main.py` ou `scheduler_service.py`) :

```python
@scheduler.scheduled_job('cron', day=1, hour=2, minute=0, id='livret_monthly_snapshot')
def livret_monthly_snapshot():
    """Crée un snapshot auto mensuel pour toutes les années actives."""
    today = date.today()
    for year in active_years():
        try:
            snapshot_service.create_snapshot(
                year=year,
                snapshot_type=SnapshotType.AUTO_MONTHLY,
                as_of_date=last_day_of_previous_month(today),
            )
            logger.info(f"Livret snapshot auto {year} created")
        except Exception as e:
            logger.error(f"Livret snapshot auto {year} failed: {e}")
```

`active_years()` = années où on a au moins 1 fichier ops (lookup `data/imports/operations/`).

### 4.6 — Hook clôture

Étendre `cloture_service` (ou `check_envoi_service` — choisir selon l'organisation actuelle du repo). Au moment où la clôture annuelle est validée, déclencher :

```python
snapshot_service.create_snapshot(
    year=year,
    snapshot_type=SnapshotType.CLOTURE,
    as_of_date=date(year, 12, 31),
    comment="Clôture exercice — version définitive",
)
```

Si un snapshot `cloture` existe déjà pour cette année (cas d'une re-clôture après correction), le suffixer en `cloture_v2`, `cloture_v3`, etc., et conserver les anciens (jamais supprimer un snapshot de clôture sans `force`).

### 4.7 — Router `/api/livret/snapshots`

Endpoints listés en §3. Ajouter dans `backend/routers/livret.py` (ou nouveau fichier `livret_snapshots.py` si la lisibilité le justifie).

Sécurité :
- `delete_snapshot` avec garde sur `type=="cloture"` retourne **HTTP 423** sauf `?force=true`.
- `create_snapshot` : refuser années futures (400) et années sans données (404).

## 5 — Frontend

### 5.1 — Hooks

`frontend/src/hooks/useLivretSnapshots.ts` :

- `useLivretSnapshots(year?)` — liste filtrable, `staleTime: 30s`.
- `useCreateLivretSnapshot()` — mutation POST. Au succès, invalider `['livret-snapshots']` + `['ged-documents']`.
- `useDeleteLivretSnapshot()` — mutation DELETE. Idem invalidation.
- Helpers URL & download :
  ```typescript
  // URL inline pour iframe / embed (consultation in-app)
  export function snapshotHtmlUrl(id: string) {
    return `${API_BASE}/api/livret/snapshots/${id}/html`
  }
  export function snapshotPdfUrl(id: string) {
    return `${API_BASE}/api/livret/snapshots/${id}/pdf`
  }

  // Téléchargement forcé (blob + lien <a download>)
  export async function downloadSnapshotHtml(id: string, filename: string) {
    const blob = await fetch(snapshotHtmlUrl(id)).then(r => r.blob())
    triggerBlobDownload(blob, filename)
  }
  export async function downloadSnapshotPdf(id: string, filename: string) {
    const blob = await fetch(snapshotPdfUrl(id)).then(r => r.blob())
    triggerBlobDownload(blob, filename)
  }
  ```
  où `triggerBlobDownload` est un helper standard (`URL.createObjectURL` + `<a download>` + click + revoke). À placer dans `frontend/src/lib/download.ts` s'il n'existe pas déjà.

### 5.2 — Activer les boutons stubbed Phase 1

Dans `LivretToolbar.tsx` :

- **"Figer instantané"** → ouvre `LivretSnapshotDrawer` (nouveau composant, 480px) avec champ commentaire optionnel + sélecteur date (défaut hier) + bouton "Créer". Au succès, toast `react-hot-toast` avec deux actions : `Voir` (ouvre le viewer in-app du snapshot) + `Télécharger`.
- **"Archives (N)"** → navigue vers `/livret/{year}/archives`. Le compteur N est `useLivretSnapshots(year).data?.length ?? 0`.
- **"↓ PDF"** → bouton split (clic principal + chevron) :
  - Clic principal → ouvre **in-app** le PDF du dernier snapshot dans `PdfPreviewDrawer` (pattern existant). Si aucun snapshot → toast "Aucun snapshot — créez-en un d'abord" avec bouton "Créer maintenant".
  - Chevron → menu : `Voir le dernier (in-app)` / `Télécharger le dernier` / `Créer un instantané maintenant et voir`.
- **"↓ HTML"** → bouton split identique :
  - Clic principal → ouvre **in-app** le HTML du dernier snapshot dans `LivretSnapshotViewerDrawer` (nouveau, voir §5.5).
  - Chevron → menu identique.

### 5.3 — Page Archives

`frontend/src/components/livret/LivretArchivesPage.tsx`, route `/livret/:year/archives`.

Layout :

- Header : `Archives — {year}` + bouton retour vers `/livret/{year}`.
- Filtres : type (Auto / Manuel / Clôture), période (mois).
- Liste : un row par snapshot, avec :
  - Date (font-variant-numeric: tabular-nums).
  - Badge type coloré (auto bleu / manuel ambre / clôture vert).
  - Commentaire (italique, tronqué).
  - Tailles HTML/PDF en `Ko` ou `Mo`.
  - **4 actions par snapshot** (icônes Lucide + tooltip) :
    - 👁 `Eye` → **Voir HTML in-app** (ouvre `LivretSnapshotViewerDrawer`)
    - 📄 `FileText` → **Voir PDF in-app** (ouvre `PdfPreviewDrawer` existant)
    - ⬇ `Download` → menu déroulant `Télécharger HTML` / `Télécharger PDF`
    - 🗑 `Trash2` → **Supprimer** (sauf clôture sans confirmation `force`)
- Bouton flottant "Créer un instantané" en haut-droite.

### 5.4 — `LivretSnapshotDrawer` (création)

Form avec :

- Date de fige : `as_of_date`, défaut hier (peut être avancé jusqu'à aujourd'hui).
- Commentaire libre (textarea, optionnel).
- Bouton "Créer l'instantané" (loader pendant ~2-5 s — gros payload livret + génération HTML + génération PDF).
- À succès : afficher un récap (taille HTML / PDF, deux boutons d'action `Voir HTML` (in-app) / `Voir PDF` (in-app), plus un menu `Télécharger`).

### 5.5 — `LivretSnapshotViewerDrawer` (consultation HTML in-app) — NOUVEAU

`frontend/src/components/livret/LivretSnapshotViewerDrawer.tsx`. Drawer large (~85% de la largeur viewport, max 1400px).

Structure :

```tsx
<div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-background"
     style={{ width: 'min(85vw, 1400px)' }}>
  <header className="flex items-center justify-between p-4 border-b">
    <div>
      <h2>Livret comptable {year}</h2>
      <span className="text-sm text-secondary">
        Instantané du {snapshot_date} · <Badge>{type}</Badge>
      </span>
    </div>
    <div className="flex gap-2">
      <Button onClick={() => downloadSnapshotHtml(id, filename)}>
        <Download size={14} /> Télécharger
      </Button>
      <Button variant="ghost" onClick={() => window.open(snapshotHtmlUrl(id), '_blank')}>
        <ExternalLink size={14} /> Nouvel onglet
      </Button>
      <Button variant="ghost" onClick={onClose}><X /></Button>
    </div>
  </header>
  <iframe
    src={snapshotHtmlUrl(id)}
    sandbox="allow-scripts"
    className="flex-1 w-full border-0"
    title={`Livret ${year} — ${snapshot_date}`}
  />
</div>
```

**Important — `sandbox="allow-scripts"` seulement** :
- Permet aux scripts inline du HTML autonome de tourner (filtres, expand/collapse).
- Bloque cookies, accès au parent, formulaires soumis ailleurs, etc.
- Pas besoin de `allow-same-origin` puisque le HTML est autonome (pas de fetch, pas de localStorage requis — tout est en mémoire JS).

**Backdrop** : overlay semi-transparent comme les autres drawers du projet (`bg-black/40`), clic = fermeture.

**État loader** : afficher un spinner centré pendant que l'iframe charge (event `onLoad`).

### 5.6 — Réutiliser `PdfPreviewDrawer` pour le PDF

Le projet a déjà un `PdfPreviewDrawer` (700px, utilisé par les Charges forfaitaires, Justificatifs, etc.). Le réutiliser tel quel en lui passant l'URL du PDF :

```tsx
<PdfPreviewDrawer
  open={pdfOpen}
  onClose={() => setPdfOpen(false)}
  pdfUrl={snapshotPdfUrl(snapshotId)}
  title={`Livret ${year} — Instantané ${snapshot_date}`}
  downloadFilename={`livret_${year}_${snapshot_date}.pdf`}
/>
```

Si la signature actuelle de `PdfPreviewDrawer` ne supporte pas une URL externe (hypothèse à vérifier — il prend peut-être un blob ou un nom de fichier GED), l'enrichir d'un prop `pdfUrl` qui prime sur les autres sources. Pas de duplication de composant.

## 6 — Cas limites

- **Snapshot pendant qu'un autre est en cours pour la même année** : 423 retourné, message "Un snapshot est déjà en cours pour cette année". Lock par fichier `.lock` à côté du manifest.
- **Snapshot d'une année future** : refuser (400 "Impossible de figer une année non débutée").
- **Disk full** : try/except autour des écritures fichier, rollback (suppression des fichiers partiels) + erreur 507.
- **Manifest corrompu** : sauvegarde automatique `manifest.json.bak` à chaque écriture, fallback en lecture si le primaire est invalide JSON.
- **HTML > 5 MB** : warning dans le manifest (`large: true`), mais on accepte. Si > 50 MB → erreur 413 (probablement bug dans le générateur).
- **APScheduler down/restart pendant un job** : à la prochaine exécution, le job vérifie si un snapshot `auto_monthly` existe déjà pour la période (clé : `year + "auto_monthly" + month`) ; sinon il rattrape.

## 7 — Vérifications manuelles

1. Bouton "Figer instantané" → snapshot créé en < 5 s → fichiers présents dans `data/livret_snapshots/{year}/`.
2. Téléchargement HTML : ouvert dans un navigateur **sans serveur** (file:// ou autre dossier), navigation/filtres/expand fonctionnent, aucune erreur réseau dans la console.
3. Téléchargement PDF : 30-60 pages, sommaire cliquable, en-têtes/pieds présents, formatage propre.
4. **Voir HTML in-app** depuis Archives ou toolbar → drawer 85% s'ouvre, iframe charge le HTML, filtres/expand opérationnels dans l'iframe, bouton Télécharger force le download blob.
5. **Voir PDF in-app** depuis Archives ou toolbar → `PdfPreviewDrawer` s'ouvre avec le PDF, scroll/zoom natifs du viewer fonctionnent.
6. Iframe sandbox : ouvrir devtools → onglet Network de la page parente ne montre **aucun** fetch venant de l'iframe (preuve d'autonomie).
7. Démarrer une `cloture_service.validate_cloture(2024)` → snapshot type "cloture" créé automatiquement et visible dans Archives.
8. Tenter de supprimer un snapshot "cloture" sans `force` → erreur 423 + toast informatif.
9. Tenter de supprimer avec `?force=true` → succès.
10. Job APScheduler : forcer un appel manuel via interpréteur Python → snapshot auto créé.
11. Manifest cohérent après 5+ snapshots, pas de duplicate ID.
12. Page Archives : tri DESC, filtres fonctionnels, badges colorés, 4 actions par row.
13. Snapshot embarque les bons chiffres (les `ytd_metrics` du manifest matchent ceux affichés dans le HTML/PDF).

## 8 — Documentation finale

- `CLAUDE.md` : section Livret enrichie de la sous-section **Snapshots** (déclencheurs, formats, manifest, pattern lock, hook clôture).
- `CHANGELOG.md` : `Added (YYYY-MM-DD): Livret Phase 3 — snapshots + exports HTML/PDF + page Archives`.
- `api-reference.md` : sous-section `/api/livret/snapshots` complète avec exemples de réponses.

## 9 — Ordre d'implémentation

1. `snapshot_service.py` — CRUD + manifest + lock (sans générateurs encore — peut générer des snapshots vides pour valider la structure).
2. `livret_html_generator.py` + template Jinja2 (commencer par un rendu minimal puis enrichir).
3. `livret_pdf_generator.py` (ReportLab story).
4. Endpoints router (servir inline par défaut) + tests `curl`.
5. Job APScheduler.
6. Hook clôture.
7. Frontend hooks (`useLivretSnapshots`, helpers URL + download blob).
8. `LivretSnapshotViewerDrawer` (HTML in-app, iframe sandbox).
9. Adapter `PdfPreviewDrawer` pour accepter une URL externe si besoin.
10. `LivretSnapshotDrawer` (création) + activation des boutons toolbar (split avec preview in-app par défaut).
11. `LivretArchivesPage` + route, avec 4 actions par snapshot.
12. Vérifications manuelles.
13. Documentation.

Conventional Commits suggérés :

- `feat(livret): snapshot_service with manifest + lock`
- `feat(livret): standalone HTML generator (Jinja2)`
- `feat(livret): paginated PDF generator (ReportLab)`
- `feat(livret): /api/livret/snapshots endpoints (inline default)`
- `feat(livret): APScheduler monthly snapshot job`
- `feat(livret): cloture hook auto-snapshot`
- `feat(livret): frontend hooks + blob download helpers`
- `feat(livret): LivretSnapshotViewerDrawer (in-app HTML viewer)`
- `feat(pdf-preview): support external URL prop`
- `feat(livret): snapshot drawer + activated toolbar with in-app previews`
- `feat(livret): archives page with 4 actions per snapshot`
- `docs(livret): CLAUDE.md + CHANGELOG + api-reference for phase 3`
