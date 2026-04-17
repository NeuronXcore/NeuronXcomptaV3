# Prompt Claude Code — Sandbox comme Boîte d'arrivée (onglet « Sandbox » dans `/ocr`)

## Objectif

Transformer `data/justificatifs/sandbox/` en **véritable file d'attente visible** dans l'UI au lieu d'un simple point d'entrée transitoire. Les fichiers **non-canoniques** déposés en sandbox y restent jusqu'à action manuelle (rename + OCR) depuis un nouvel onglet `/ocr?tab=sandbox`. Les fichiers **canoniques** continuent d'être traités instantanément par le watchdog (flow actuel, aucune régression).

**Bénéfice métier** : en scan-rafale (consultation médicale, courses pro), le médecin AirDrope 10 tickets non nommés → ils apparaissent tous dans l'onglet Sandbox → rename inline à la convention `fournisseur_YYYYMMDD_montant.XX.pdf` → `[Lancer OCR]` → filename-first gagne à 100% → auto-rapprochement quasi systématique. Zéro correction OCR a posteriori.

## Principe architectural

**Le filesystem `sandbox/` EST l'état.** Aucun nouveau dossier, aucun `inbox.json`, aucun service de queue avec persistance. Un fichier présent = en attente. Absent = traité ou supprimé. La source de vérité est `GET /api/sandbox/list`.

**Watchdog conditionnel** : `is_canonical(filename)` décide du routage au moment de `on_created`.

## Règles métier

| Situation | Comportement |
|-----------|--------------|
| Fichier déposé, nom canonique (ex: `edf_20260115_47.20.pdf`) | Flow actuel : move sandbox→en_attente + OCR + auto-rapprochement |
| Fichier déposé, nom non-canonique (ex: `Scan_0417_103422.pdf`) | **Reste dans sandbox/**, event SSE `arrived`, apparaît dans l'onglet Sandbox |
| User renomme un fichier de sandbox/ vers un nom canonique | **Ne déclenche PAS l'OCR automatiquement** (mode manuel = défaut). Le nouveau nom est juste stocké sur disque. User doit cliquer `[Lancer OCR]` |
| User clique `[Lancer OCR]` | `POST /api/sandbox/{filename}/process` → move vers en_attente + OCR + auto-rapprochement (= flow actuel appliqué à la demande) |
| User clique `[Supprimer]` | `DELETE /api/sandbox/{filename}` (existe déjà) |
| Mode auto activé dans Settings | Scheduler background scanne sandbox/ toutes les 10s, traite les fichiers présents depuis plus de `auto_delay_seconds` |

## Backend

### Modification `backend/services/sandbox_service.py`

1. **Extraire la logique existante OCR-pipeline** dans une fonction privée réutilisable :
   ```python
   def _process_from_sandbox(filename: str) -> dict:
       """Move sandbox → en_attente + OCR + auto-rapprochement.
       Retourne le résultat enrichi (supplier, date, amount, operation_ref si match).
       Appelée depuis on_created (canonique auto) ET depuis l'endpoint /process."""
   ```

2. **Watchdog `on_created` devient conditionnel** :
   ```python
   def on_created(self, event):
       # ... validation extension, attente écriture complète, conversion image → PDF ...
       # La conversion image→PDF reste dans sandbox/ (pas de move vers en_attente)
       
       if rename_service.is_canonical(final_name):
           _push_event(filename=final_name, status="scanning")
           _process_from_sandbox(final_name)
       else:
           _register_sandbox_arrival(final_name)  # track arrived_at in-memory
           _push_event(filename=final_name, status="arrived", original_filename=original)
   ```

3. **In-memory tracking minimal** (pas de persistance disque) :
   ```python
   _sandbox_arrivals: dict[str, datetime] = {}  # filename → arrived_at
   _arrivals_lock = threading.Lock()
   
   def _register_sandbox_arrival(filename): ...
   def _unregister_sandbox_arrival(filename): ...  # appelé sur process/delete/rename
   def list_sandbox_arrivals() -> dict[str, datetime]: ...
   ```
   
   Au boot : scan `sandbox/` et enregistrer chaque fichier présent avec `arrived_at = file mtime` (best-effort, pas critique).

4. **Rename inplace** :
   ```python
   def rename_in_sandbox(old_filename: str, new_filename: str) -> dict:
       # Validation : extension .pdf, nom safe, pas de slash
       # Vérif collision cible dans sandbox/
       # shutil.move(sandbox/old, sandbox/new)
       # Update in-memory arrivals (transfer timestamp)
       # Retour : {old, new, is_canonical: bool}
   ```

5. **Trigger OCR à la demande** :
   ```python
   def process_sandbox_file(filename: str) -> dict:
       # Unregister arrival
       # Delegate to _process_from_sandbox(filename)
       # Retour : résultat OCR + auto-rapprochement
   ```

### Modification `backend/routers/sandbox.py`

Endpoints existants conservés : `GET /events` (SSE), `GET /list`, `POST /process` (rename en `POST /process-all` pour éviter confusion), `DELETE /{filename}`.

**Renommage** de `POST /process` (traite tout le sandbox) en `POST /process-all` pour libérer `POST /{filename}/process` pour l'unitaire. Grep toutes les utilisations de `/api/sandbox/process` dans le frontend et mettre à jour. Si l'endpoint bulk n'est plus utilisé, le supprimer.

**Nouveaux endpoints** :

```python
@router.post("/{filename}/rename")
def rename_sandbox_file(filename: str, body: RenameRequest):
    """Renomme un fichier dans sandbox/ (avant OCR)."""
    result = sandbox_service.rename_in_sandbox(filename, body.new_filename)
    return result

@router.post("/{filename}/process")
def process_sandbox_file(filename: str):
    """Déclenche OCR + rapprochement pour un fichier de sandbox."""
    return sandbox_service.process_sandbox_file(filename)
```

**Enrichissement de `GET /list`** : pour chaque fichier, ajouter `is_canonical: bool`, `arrived_at: str | None`, `auto_deadline: str | None` (si mode auto activé).

### Enrichissement du SSE

Event existant `scanning` (dès move sandbox→en_attente avant OCR) et `processed` (fin pipeline) conservés. **Nouveau** event `arrived` :

```python
data: {
  "event_id": "Scan_0417_103422.pdf@2026-04-17T10:34:22@arrived",
  "filename": "Scan_0417_103422.pdf",
  "status": "arrived",
  "timestamp": "2026-04-17T10:34:22",
  "is_canonical": false,
  "original_filename": "Scan_0417_103422.pdf"
}
```

Également rejeu depuis `sandbox/` au boot via `seed_recent_events_from_disk()` (étendre la fonction existante pour inclure les fichiers `sandbox/` en plus de `en_attente/` et `traites/`).

### Mode auto (optionnel, off par défaut)

**Nouveau fichier** `backend/services/sandbox_auto_processor.py` :

```python
async def auto_processor_loop():
    """Scanne sandbox/ toutes les 10s, traite les fichiers arrivés depuis > delay."""
    while True:
        await asyncio.sleep(10)
        settings = settings_service.get_ocr_settings()
        if not settings.sandbox_auto_mode:
            continue
        
        delay = settings.sandbox_auto_delay_seconds  # default 30
        now = datetime.now()
        
        for filename, arrived_at in sandbox_service.list_sandbox_arrivals().items():
            if (now - arrived_at).total_seconds() >= delay:
                try:
                    sandbox_service.process_sandbox_file(filename)
                except Exception as e:
                    logger.warning(f"Auto-process failed for {filename}: {e}")
```

Démarrage/arrêt via `lifespan()` de `main.py` (à côté du watchdog existant).

### Settings

Étendre `backend/services/settings_service.py` (ou l'équivalent — dans data/settings.json probablement) avec :

```json
{
  "ocr": {
    "sandbox_auto_mode": false,
    "sandbox_auto_delay_seconds": 30
  }
}
```

Endpoints : réutiliser le système de settings existant (probablement `GET/PUT /api/settings/ocr` ou similaire — adapter au pattern en place).

## Frontend

### Nouveau composant `frontend/src/components/ocr/SandboxTab.tsx`

Premier onglet de `OcrPage`. Affiche la liste des fichiers de `GET /api/sandbox/list`. Chaque row contient :

- **Thumbnail 60×84** — les fichiers sandbox n'ont pas encore de thumbnail GED. Solution : nouvel endpoint `GET /api/sandbox/{filename}/thumbnail` qui génère à la volée via `pdf2image` (cache optionnel dans `data/sandbox_thumbs/`, nettoyable). Fallback icône PDF générique si génération échoue.
- **FilenameEditor inline** (réutiliser le composant existant) — mais branché sur `POST /api/sandbox/{filename}/rename` au lieu de `/api/justificatifs/.../rename`. Factoriser le hook ou ajouter un prop `endpoint` au composant.
- **Badge statut** : `En attente` (bg-amber), `OCR en cours` si transition vers en_attente en cours, `Canonique ✓` si `is_canonical: true` mais encore en sandbox (cas rare, user a renommé puis pas encore OCR).
- **Meta** : `arrivé il y a Xs/min/h` (timeago depuis `arrived_at`), taille humaine.
- **Countdown barre** : visible uniquement si `auto_mode` activé, décompte `auto_deadline - now`.
- **Boutons** : `[Lancer OCR]` (primary, disabled si OCR en cours) → `POST /{filename}/process` · `[×]` (danger) → `DELETE /{filename}` avec `showDeleteConfirmToast`.

### Hook `frontend/src/hooks/useSandboxInbox.ts`

```typescript
export function useSandboxInbox() {
  // 1. TanStack Query sur GET /api/sandbox/list (refetch 5s + invalidation manuelle)
  // 2. Subscribe au SSE /api/sandbox/events existant
  // 3. Sur event 'arrived' : invalidate ['sandbox', 'list']
  // 4. Sur event 'processed' : invalidate ['sandbox', 'list'] + ['ocr-history']
  // 5. Retourne { items, isLoading, refetch }
}

export function useRenameInSandbox() { /* mutation POST rename + invalidation */ }
export function useProcessSandboxFile() { /* mutation POST process + invalidation */ }
export function useDeleteFromSandbox() { /* mutation DELETE + invalidation */ }
export function useOcrSandboxSettings() { /* GET/PUT settings */ }
```

### Modification `frontend/src/components/ocr/OcrPage.tsx`

```tsx
const tabs = [
  { key: 'sandbox', label: 'Sandbox', badge: sandboxCount },
  { key: 'upload', label: 'Upload manuel' },
  { key: 'test', label: 'Test OCR' },
  { key: 'historique', label: 'Gestion OCR' },
  { key: 'templates', label: 'Templates' },
];
```

URL param `/ocr?tab=sandbox` ouvre directement l'onglet. Default tab : `sandbox` si `sandboxCount > 0` au montage, sinon `historique` (préserve le comportement actuel pour les retours d'autres pages comme Pipeline).

### Raccourcis clavier dans `SandboxTab`

- `↵` dans un FilenameEditor : sauvegarde rename (comportement existant)
- `⇧↵` : rename puis **Lancer OCR** directement (chain mutation)
- `⌘⌫` / `Ctrl+Backspace` sur row focused : supprime avec confirm
- `Tab` / `⇧Tab` : navigue entre les filename editors

Utiliser `useKeyboardShortcut` existant (si présent) ou créer un handler local à l'onglet.

### Settings UI

Dans la page Settings (ou la tab OCR Settings si elle existe), ajouter :

```tsx
<section>
  <h3>Sandbox — Mode de traitement</h3>
  <Toggle
    label="OCR automatique après délai"
    checked={settings.sandbox_auto_mode}
    onChange={...}
  />
  {settings.sandbox_auto_mode && (
    <Slider
      label="Délai avant OCR auto"
      min={15} max={300} step={15}
      value={settings.sandbox_auto_delay_seconds}
      format={(v) => v < 60 ? `${v}s` : `${Math.round(v/60)}min`}
    />
  )}
  <p className="text-xs text-text-muted">
    Par défaut (mode manuel), les fichiers non-canoniques restent dans sandbox jusqu'à action explicite.
    Les fichiers au nom canonique sont toujours traités instantanément.
  </p>
</section>
```

Mini-version inline dans le header de `SandboxTab` (toggle + slider compacts) pour ajustement rapide.

### Badge sidebar

Dans `Sidebar.tsx`, ajouter un badge sur l'entrée OCR : `sandboxCount` (depuis `useSandboxInbox`). Compteur visible si > 0.

### Conversion image → PDF

Actuellement `sandbox_service` convertit les images (JPG/PNG) en PDF à l'arrivée. Avec le nouveau flow, cette conversion doit rester **mais rester dans sandbox/** au lieu d'être suivie d'un move vers en_attente. Vérifier que `_convert_image_to_pdf()` écrit bien le PDF dans sandbox/ puis supprime l'image originale, SANS move vers en_attente. Le PDF résultant passe ensuite dans la logique `is_canonical` du watchdog comme un nouveau fichier (ou directement puisqu'on est déjà dans `on_created`).

## Backward compatibility

1. **Watchdog actuel** : préservé pour les canoniques → aucune régression sur les scans nommés correctement avant transfert.
2. **Fichiers déjà en en_attente/** : pas affectés, restent dans Gestion OCR comme avant.
3. **Fichiers présents dans sandbox/ au boot** : enregistrés avec `arrived_at = mtime`, apparaissent dans l'onglet Sandbox (pas de traitement auto, même si canoniques — sécurité).
4. **Endpoint `POST /api/sandbox/process`** : renommé en `/process-all` pour désambiguïser. Chercher les utilisations frontend et mettre à jour.

## Fichiers créés / modifiés

### Créer

1. `backend/services/sandbox_auto_processor.py` — loop asyncio
2. `frontend/src/hooks/useSandboxInbox.ts`
3. `frontend/src/components/ocr/SandboxTab.tsx`
4. `frontend/src/components/ocr/SandboxRow.tsx` (extrait pour lisibilité)
5. `tests/test_sandbox_service.py` — ajouter `test_non_canonical_stays_in_sandbox`, `test_canonical_triggers_ocr`, `test_rename_in_sandbox`, `test_process_sandbox_file`, `test_auto_processor_respects_delay`

### Modifier

6. `backend/services/sandbox_service.py` — split `_process_from_sandbox`, watchdog conditionnel, in-memory arrivals, rename + process APIs
7. `backend/routers/sandbox.py` — nouveaux endpoints + enrichissement `/list` + `/{filename}/thumbnail` + rename `/process` → `/process-all`
8. `backend/services/settings_service.py` — clés `sandbox_auto_mode` + `sandbox_auto_delay_seconds`
9. `backend/main.py` — lifespan : start/stop `sandbox_auto_processor`
10. `backend/core/config.py` — `SANDBOX_THUMBS_DIR` (optionnel, pour cache thumbs sandbox)
11. `frontend/src/components/ocr/OcrPage.tsx` — onglet Sandbox en 1er
12. `frontend/src/components/ocr/FilenameEditor.tsx` — prop optionnel `endpoint` pour router rename sandbox vs justificatif, OU créer un hook wrapper
13. `frontend/src/components/layout/Sidebar.tsx` — badge compteur
14. `frontend/src/components/settings/...` — section Sandbox
15. `frontend/src/hooks/useSandbox.ts` — si existant, enrichir pour exposer `is_canonical` et `arrived_at` dans les items
16. `api-reference.md` — documenter les 3 nouveaux endpoints
17. `architecture.md` — schéma de flux mis à jour (sandbox = inbox)
18. `CLAUDE.md` — section OCR mise à jour : « Sandbox » comme premier onglet, watchdog conditionnel, mode manuel par défaut
19. `CHANGELOG.md` — entry Session X

## Tests manuels de validation

- [ ] Déposer `ticket_auchan.pdf` (non canonique) dans sandbox/ → apparaît dans l'onglet Sandbox en < 2s, **reste sur disque dans sandbox/**
- [ ] Renommer inline en `auchan_20260417_12.50.pdf` → toast succès, le fichier est renommé sur disque **dans sandbox/**, pas d'OCR lancé
- [ ] Cliquer `[Lancer OCR]` → fichier déplacé vers en_attente/, OCR tourne, toast `SandboxArrivalToast` existant, disparaît de l'onglet Sandbox
- [ ] Déposer `edf_20260115_47.20.pdf` (déjà canonique) → **skip** l'onglet Sandbox, OCR immédiat, apparaît dans Gestion OCR
- [ ] Rafale de 10 fichiers non-canoniques → les 10 apparaissent, aucun OCR lancé
- [ ] `⇧↵` dans un FilenameEditor d'un row → rename + OCR chained
- [ ] `⌘⌫` sur row focused → confirm toast puis `DELETE /api/sandbox/{filename}`
- [ ] Activer `sandbox_auto_mode` à 30s dans Settings → countdown visible dans les rows, OCR se lance automatiquement après 30s si pas d'action
- [ ] Redémarrer backend → les fichiers dans sandbox/ réapparaissent dans l'onglet (seeded depuis disque)
- [ ] Vérifier qu'un fichier non-canonique déposé ne crée PAS de `.ocr.json` tant que `[Lancer OCR]` n'est pas cliqué
- [ ] Vérifier que la conversion JPG → PDF laisse le PDF dans sandbox/ (ne le déplace pas prématurément)

## Prérequis

**Le Prompt #1 (fix bug rename + regex canonique restreinte) doit être mergé avant.** Sinon des pseudo-canoniques (avec timestamp de dédup) seraient classifiés comme canoniques par le watchdog et traités instantanément au lieu d'apparaître dans l'onglet Sandbox où l'utilisateur pourrait les corriger.

## Ordre d'implémentation recommandé

1. Backend : split `_process_from_sandbox()` et arrivals in-memory (refacto pur, aucun changement de comportement externe)
2. Backend : watchdog conditionnel + event SSE `arrived`
3. Backend : endpoints `rename` + `process` + `thumbnail` + renommage `/process-all`
4. Backend : settings + auto-processor loop
5. Backend : tests
6. Frontend : hooks `useSandboxInbox` + mutations
7. Frontend : `SandboxTab` + `SandboxRow` isolés (peut être testé en se connectant au backend déjà déployé)
8. Frontend : intégration `OcrPage` + sidebar badge
9. Frontend : settings UI
10. Docs (api-reference, architecture, CLAUDE.md, CHANGELOG)

Commit isolé par couche backend, commit frontend global une fois testé visuellement.

## Ne pas toucher

- Le flow OCR pour les canoniques (`_process_from_sandbox`) — juste l'extraire en fonction, ne rien changer à la logique
- `ScanRenameDrawer` (complémentaire, pour batch rescan de en_attente/ et traites/)
- `OcrEditDrawer` (complémentaire, pour édition post-OCR)
- Auto-rapprochement post-OCR (inchangé)
- Logique fac-similés `_fs` (inchangé)
- Rename logique pour les fichiers **en_attente/** ou **traites/** (passe toujours par `POST /api/justificatifs/{filename}/rename` — endpoint séparé et différent du nouveau `POST /api/sandbox/{filename}/rename`)
