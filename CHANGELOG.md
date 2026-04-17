# Changelog

Toutes les modifications notables de NeuronXcompta sont documentees ici.

Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [Unreleased]

### Added (2026-04-17) — Session 30 · Polish UX Sandbox + perf OCR

- **Checkboxes batch OCR dans Sandbox** — sélection par ligne (checkbox 22×22 primary avant la thumbnail, opacity 40%→100% au hover) + Select All tri-état dans la toolbar (Check / Minus / empty selon `filtered.every`/`some`/`none`) + **barre flottante batch** (`fixed bottom-6 left-1/2 -translate-x-1/2`) avec compteur badge, pill warning amber `AlertTriangle` si non-canoniques dans la sélection, bouton « Lancer OCR (N) » primary, bouton X pour dismiss. Lance N `POST /api/sandbox/{filename}/process` en parallèle via `Promise.allSettled` (fire-and-forget — le backend traite chaque appel en thread daemon). Auto-purge des sélections quand les fichiers quittent la sandbox.
- **3 toasts riches distincts pour les events SSE sandbox** :
  - `SandboxScanningToast` (cyan/sky, animations `scan-sweep` ligne horizontale qui balaie verticalement l'icône document + `scan-ring` anneau pulsant + `scan-dot` 3 dots séquentiels) — status `scanning`
  - `SandboxPendingToast` (amber/orange, icône `Inbox`, CTA « Ouvrir la boîte d'arrivée » cliquable → `/ocr?tab=sandbox`, persistent) — status `arrived` non-canonique
  - `SandboxArrivalToast` (violet ou emerald) — status `processed` (existait déjà)
- **Preview PDF inline** dans un drawer (slide-from-right 720px) au lieu d'un nouvel onglet — backdrop `bg-black/50 backdrop-blur-sm` cliquable, `Esc` handler global, bouton X + fallback « Ouvrir dans un onglet ». Rendu via `<object type="application/pdf">` avec toolbar native.
- **Preload EasyOCR au lifespan backend** (`ocr_service.preload_reader_async` → thread daemon appelle `_get_reader()` en arrière-plan dès le boot). Élimine le cold start ~20-30s du 1er OCR post-reboot — `reader_loaded=True` en ~3s après boot (modèle déjà en cache disque `~/.EasyOCR/model/`). Le backend commence à servir les requêtes immédiatement (pas de blocage lifespan).
- **`POST /api/sandbox/{filename}/process` en background task** — retour immédiat `{status: "started", filename}` au lieu d'attendre la fin d'OCR + rapprochement (10-30s avec EasyOCR). Le pipeline tourne dans un thread daemon, la progression arrive via les SSE events `scanning` → `processed`. Résout le « Failed to fetch » côté frontend quand l'OCR prenait plus que le timeout fetch browser.
- **Countdown bar auto-mode dynamique** — fix du bug où la barre restait bloquée sur « OCR auto dans 7s » : `nowTs` state désormais dans les deps du `useMemo` (avant, le setInterval déclenchait des re-renders mais le memo ne re-évaluait pas). Tick 250ms + `transition-[width] duration-300 ease-linear` pour lisser entre ticks. Gradient `amber-400 → orange-500`, barre 1.5px, label timer `min-w-[90px] text-right` pour stabiliser l'alignement horizontal.
- **Config preview Claude sur ports alternatifs** — `.claude/launch.json` backend sur `8100`, frontend sur `5273` avec env `VITE_API_URL=http://127.0.0.1:8000`. `frontend/vite.config.ts` proxy target configurable via `process.env.VITE_API_URL` (défaut `http://127.0.0.1:8000`). Permet de faire tourner `preview_start` sans conflit avec le `start.sh` local sur `5173/8000`.
- **`PdfThumbnail` étendu** avec prop `sandboxFilename` → `/api/sandbox/{name}/thumbnail` (cache PNG séparé `data/sandbox_thumbs/` hors GED).
- **`LEGACY_TAB_ALIASES` + `VALID_TABS`** validation stricte des URL params `/ocr?tab=` — tout param non reconnu fallback sur règle métier (sandbox si > 0, sinon upload).
- **DevX — filet de sécurité ports** : nouveau script `kill-ports.sh` à la racine (lsof + pkill pour 8000 et 5173) à lancer manuellement quand un worker uvicorn zombie squatte le port. `start.sh` gagne un pre-kill automatique au boot + un trap EXIT/INT/TERM qui libère les ports dans tous les cas de sortie. Résout les `EADDRINUSE` après un reload mal terminé (handler natif bloqué au-delà des 2s de `--timeout-graceful-shutdown`).

### Changed (2026-04-17) — Session 30 · Réorganisation des onglets `/ocr`

- **6 onglets dans l'ordre métier** (au lieu de 5) : Upload & OCR / Test Manuel / Sandbox / En attente / Traités / Templates. L'ancien « Gestion OCR » est splitté en 2 onglets distincts (**En attente** et **Traités**) qui correspondent aux 2 dossiers physiques `en_attente/` et `traites/`.
- **Même composant `OcrListTab`** (ex-`HistoriqueTab`) pour les 2 nouveaux onglets, avec prop `statusFilter: 'en_attente' | 'traites'` qui fige le statut côté interne via reverse-lookup. Zéro duplication de code.
- **Suppression du filtre segmenté Association** (tous/sans/avec) : l'onglet actif détermine déjà le statut. Remplacé par un compteur live (`{N} sans assoc.` / `{N} associé(s)`) qui reflète les items après filtres mois + fournisseur + statusFilter.
- **Alias legacy** `?tab=historique` → `en-attente` dans `LEGACY_TAB_ALIASES` pour rattraper les events SSE rejoués au reload (fenêtre 180s backend ring buffer) et tous les anciens liens sauvegardés.
- **Validation stricte** des URL params via `VALID_TABS` — tout param non reconnu fallback sur la règle métier (`sandbox` si count > 0, sinon `upload`).
- **SandboxArrivalToast** navigation mise à jour : CTA « Voir en attente » (au lieu de « Voir dans l'historique ») qui route vers `/ocr?tab=en-attente&sort=scan_date&highlight=X`.
- **Badges d'onglets** : Sandbox amber (`sandbox_count`), En attente orange (`en_attente_count`), Traités emerald (`traites_count`) — les 3 alimentés par `/api/justificatifs/stats`.

### Added (2026-04-17) — Session 29 · Sandbox = boîte d'arrivée OCR

- **Onglet Sandbox dans `/ocr` (1er onglet)** — transforme `data/justificatifs/sandbox/` en file d'attente visible. Les fichiers non-canoniques (ex. `Scan_0417_103422.pdf`) restent sur disque et apparaissent dans l'UI au lieu de déclencher immédiatement l'OCR sur un mauvais nom. Usage type : scan-rafale AirDrop de 10 tickets pendant une course pro → onglet Sandbox → rename inline à la convention `fournisseur_YYYYMMDD_montant.XX.pdf` → `[Lancer OCR]` → filename-first gagne 100% → auto-rapprochement quasi systématique, zéro correction a posteriori.
- **Watchdog conditionnel** — `sandbox_service._process_file()` branche selon `rename_service.is_canonical(filename)` : canonique → flow historique (extrait en `_process_from_sandbox()` réutilisable depuis watchdog + endpoint unitaire + auto-processor) ; non-canonique → reste dans sandbox/, `_register_sandbox_arrival()` + event SSE `arrived` (enrichi `is_canonical: bool`). Les images JPG/PNG sont converties en PDF **inplace dans sandbox/** (pas de move prématuré).
- **Nouveaux endpoints** — `POST /api/sandbox/{filename}/rename` (rename inplace avant OCR, transfère timestamp arrival, collision 409), `POST /api/sandbox/{filename}/process` (trigger OCR + rapprochement unitairement), `GET /api/sandbox/{filename}/thumbnail` (cache PNG séparé `data/sandbox_thumbs/` hors GED), `GET /api/sandbox/{filename}/preview` (stream PDF inline). Renommé `POST /api/sandbox/process` → `POST /api/sandbox/process-all`. `GET /api/sandbox/list` enrichi avec `is_canonical`, `arrived_at`, `auto_deadline`.
- **Mode auto optionnel** — `sandbox_auto_mode: bool = False` + `sandbox_auto_delay_seconds: int = 30` sur `AppSettings`. Loop asyncio `backend/services/sandbox_auto_processor.py` (poll 10s, clamp 5-3600s, no-op quand off) démarrée/arrêtée via lifespan. UI : mini toggle + slider compact dans header `SandboxTab` + section complète Settings > Général.
- **Stats enrichies** — `GET /api/justificatifs/stats` renvoie `{en_attente, traites, sandbox, total}`. Badge sidebar OCR (amber) sur `sandbox` uniquement ; badge onglet `Gestion OCR` garde `en_attente`.
- **Exclusions GED strictes** — commentaires explicites dans `justificatif_service.{get_justificatif_path, get_all_referenced_justificatifs, scan_link_issues}` et `ged_service.{build_tree, get_stats}`. Résolveur dédié `sandbox_service.get_sandbox_path()` (scope strict sandbox/).
- **Frontend** — `useSandboxInbox.ts` (list + 3 mutations), `SandboxTab.tsx` + `SandboxRow.tsx` (thumbnail cliquable, inline editor ↵ save / ⇧↵ save+process / Esc cancel / ⌘⌫ delete, badges Canonique/En attente, countdown auto-deadline). `PdfThumbnail` étendu avec prop `sandboxFilename`. `useSandbox` invalide `['sandbox']` + toast discret sur event `arrived`.
- **Seed boot** — `scan_existing_sandbox_arrivals()` appelée avant `start_sandbox_watchdog()` : seed `_sandbox_arrivals` avec `mtime` pour préserver l'ancienneté. `seed_recent_events_from_disk()` étendue aux events `arrived` depuis sandbox/ (fenêtre 180s).
- **Backward compat** — aucune régression sur les canoniques, aucun appel frontend à migrer.

### Fixed (2026-04-17) — Session 28 · Bug rename justificatif

- **Regex canonique trop permissive** — `rename_service.CANONICAL_RE` acceptait n'importe quel suffix `_[a-z0-9]+`, y compris les timestamps de dédup ajoutés par `sandbox_service._move_to_en_attente()` (`_20260417_104502`, `_104502`). Conséquence : les fichiers pseudo-canoniques type `amazon_20250128_89.99_20260417_104502.pdf` tombaient silencieusement dans le bucket `already_canonical` du scan et n'étaient jamais proposés au rename. Fix : nouvelle constante `CANONICAL_SUFFIX = r"(?:_(?:[a-z]{1,3}|\d{1,2}))*"` qui restreint aux formes légitimes (`_fs`, `_a..aaa`, `_2..99`). Suffix du parser `FILENAME_PATTERNS[0]` aligné sur la même restriction.
- **Collision silencieuse au rename (`rename_justificatif`)** — le service ne faisait qu'un check `(target_dir / new_filename).exists()` dans le dossier courant sans détecter les collisions cross-location (en_attente ↔ traites) ni discriminer doublon strict vs hash différent.
  - Résolution source + cible via `get_justificatif_path()` (cross-location).
  - Si cible existe + même MD5 → dédup automatique (supprime source + .ocr.json + thumbnail), retourne `status: "deduplicated"`.
  - Si cible existe + hash différent → `HTTPException(409)` avec detail structuré `{error: "rename_collision", message, existing_location, suggestion}`. Suggestion incrémentale cross-location `_2`, `_3`, …
  - Idempotence `old == new` préservée.
- **Frontend ne remontait pas l'erreur 409** — `api/client.ts`: nouvelle classe `ApiError extends Error` qui préserve `status` + `detail` structuré (avant, `new Error(detail)` coerçait `[object Object]` et noyait la structure). `useJustificatifs.ts`: type `RenameCollisionDetail` + type guard `isRenameCollision`. `FilenameEditor.tsx`: toast custom avec bouton « Utiliser {suggestion} » qui relance la mutation avec le nom suggéré, rollback du state local à l'ancien filename sur erreur, toast distinct « Doublon supprimé » sur `status: "deduplicated"`.
- **Historique OCR affichait des filenames obsolètes** (cause directe du « impossible à renommer sur la ligne ») — `get_extraction_history()` trustait le champ `filename` dans le `.ocr.json` qui pouvait être désyncé d'un rename historique (4 mismatches détectés en prod dont `amazon_20250128_49.86.ocr.json` qui portait `filename: amazon_20250128_89.99_20260417_104502.pdf`). Fix : dérivation du filename depuis le PDF sibling sur disque (autoritaire). Fallback legacy conservé si le PDF sibling est absent. Passe one-shot exécutée sur les 4 JSON de prod (mismatches francs + case `.PDF` → `.pdf`).
- **Migration lifespan log-only** — `rename_service.find_legacy_pseudo_canonical()` + bloc dans `lifespan()` de `main.py` qui log au boot les fichiers désormais non-canoniques avec la nouvelle regex (sans rename auto) pour audit.
- **Badge « Pseudo-canonique » ambre** dans OCR > Gestion OCR — `lib/utils.ts` expose `isCanonicalFilename()` + `isLegacyPseudoCanonical()` (miroirs stricts des regex backend). `OcrPage.tsx` : badge `<AlertTriangle /> Pseudo-canonique` cliquable à côté de `FilenameEditor` → ouvre `OcrEditDrawer`.
- **Tests unitaires** — `tests/test_rename_service.py` (6 tests : rejets timestamp/8-digit/6-digit/3-digit, acceptation `_fs`/`_a`/`_2`, détection pseudo-canonique) + `tests/test_justificatif_service.py` (4 tests avec fixture `tmp_path` + monkeypatch : idempotence, dedup same-hash, 409 different-hash, 404 source absente). **10/10 passent**.

### Added (2026-04-17) — Session 27

- **Sandbox — rejeu SSE + flux 2 toasts (scanning → processed)**
  - **Ring buffer + event_id stable** : `sandbox_service._recent_events` (`deque(maxlen=30)`, fenêtre 180s) alimenté à chaque `_push_event()`. `event_id = f"{filename}@{timestamp}@{status}"` garantit le dédup cross-reload entre push live et rejeu disque. Au connect SSE : rejeu auto des events récents (flag `replayed: true`).
  - **Seed disque au startup** : `seed_recent_events_from_disk()` scanne `en_attente/*.ocr.json` **ET `traites/*.ocr.json`** (`processed_at > now - 180s`). Les fichiers en `traites/` sont marqués `auto_associated: true` avec leur op de rattachement (via `_lookup_operation_ref()` qui scanne les ops pour trouver le `Lien justificatif` ou la sous-ligne ventilée référençante). Appelé dans le lifespan `main.py` après `start_sandbox_watchdog()`.
  - **Flux 2 toasts** :
    - Toast 1 « scanning » : poussé immédiatement après le move sandbox → en_attente, avant l'OCR. Frontend affiche un `toast.loading()` neutre « Analyse en cours… filename » (top-right, 60s filet).
    - Toast 2 « processed » : poussé en fin de pipeline (OCR + auto-rename + auto-rapprochement). Frontend dismiss le toast 1 correspondant (matching via `original_filename || filename`) puis affiche le toast riche (violet ou vert).
    - Dédup frontend via `SEEN_EVENT_IDS: Set<string>` module-level (FIFO 200 entrées). Les events `scanning` ne sont pas rejoués au reconnect (trop court-vivant).
  - **Toast « Associé automatiquement »** (vert emerald, `CheckCircle2` au lieu de `ScanLine`) : variante du `SandboxArrivalToast` quand l'event porte `auto_associated === true`. Bloc op sous les chips (libellé + date + montant) dans un cadre emerald. CTA « Voir l'opération » → `/justificatifs?file=X&highlight=Y&filter=avec`. Variante violette classique préservée pour les arrivées sans auto-match.
  - **Pill `🔒 LOCKED`** (amber/warning) dans le bloc op quand `operation_ref.locked === true` (auto-lock score ≥ 0.95 — voir ci-dessous). Tooltip « Opération verrouillée automatiquement (score ≥ 0.95) ».

- **Auto-lock sur auto-association si score ≥ 0.95 (paramètre)**
  - `rapprochement_service._run_auto_rapprochement_locked()` : après `justificatif_service.associate()` réussi, si `best_score >= 0.95` → set `op.locked = True` + `locked_at = isoformat()` sur l'op, persiste via `save_operations()`. Implémenté dans les 2 branches (ventilée + non-ventilée).
  - **Matrice** : score 0.60–0.80 = suggestion (pas d'association). 0.80–0.95 = auto-associé, modifiable. ≥ 0.95 = auto-associé + auto-lock.
  - `associations_detail` enrichi avec `locked: bool` + `score: float`. Event SSE `operation_ref.locked` et `score` propagés jusqu'au toast.

- **Gate date obligatoire pour l'auto-rapprochement**
  - `_run_auto_rapprochement_locked()` : refuse toute auto-association si `best_match.score.detail.date <= 0.0` (i.e., écart > 14j), **indépendamment du score total**. Résout le bug cross-year : auto-associations à 0.80 pile par montant+fournisseur+catégorie parfaits mais date à 1 an → score_date=0 compensait auparavant. Exemple bloqué : `amazon_20250103_16.99_2.pdf` matché à une op 2026-01-14 de 16,99 €.
  - Ces candidats passent en `suggestions_fortes` (visibles dans le drawer manuel) au lieu de disparaître silencieusement.
  - Run-auto sur corpus réel : passage de 1 auto-association cross-year → 0, 21 suggestions fortes, 141 sans correspondance.

- **Passe systémique — reconnexion ventilation post-split/merge**
  - Nouveau bucket `reconnectable_ventilation` dans `justificatif_service.scan_link_issues()` : pour chaque orphan de `traites/` (PDF non référencé), parse le filename canonique via `rename_service.try_parse_filename()` → `(supplier, YYYYMMDD, amount)`. Scanne toutes les ops pour trouver une sous-ligne ventilée **vide** avec `date_op == date_filename` + `abs(montant - amount) <= 0.01`. Si match unique → reconnect candidat (ambiguïtés skippées).
  - `apply_link_repair()` : nouvelle étape 3b (avant les moves vers en_attente) qui applique les reconnexions groupées par fichier d'ops, avec re-check idempotence. Invalide le cache des références.
  - Compteur `ventilation_reconnected` dans le `RepairLinksResult`. Card `IntegrityMetric` ajoutée dans `SettingsPage > Stockage > Intégrité des justificatifs` (« Ventilation à reconnecter »).
  - **Auto-heal au boot** : le lifespan backend lance déjà `apply_link_repair()` → les desyncs post-split/merge sont réparés silencieusement au démarrage si les filenames canoniques matchent.

- **EditorPage — 6 pills cliquables dans le header (compteurs live + filtres toggle)**
  - `headerCounters: useMemo([operations, exemptions])` agrège 6 métriques : `withJ, withoutJ, exempt, locked, unlocked, facsimile, total`. Re-calcul automatique à chaque mutation (save, undo, categorize, associate, unlock).
  - 6 pills côte-à-côte dans `PageHeader.actions` : 📎 vert emerald (avec), 📎 ambre (sans, exclut exemptées), ✓ bleu sky (exempt, si > 0), 🔒 orange warning (locked), 🔓 rose (unlocked = avec justif mais pas locked, « à valider », si > 0), 📄 violet (facsimile = reconstitué, si > 0).
  - **Clic = filtre toggle** : active un column filter sur `Justificatif` avec valeur magique (`__header_avec__`, `__header_sans__`, `__header_exempt__`, `__header_locked__`, `__header_unlocked__`, `__header_facsimile__`). Re-clic désactive. Visuel `ring-2 ring-*` + fond renforcé quand actif.
  - Reset automatique du filtre au changement de fichier ou passage year-wide.
  - Filterfn custom interprète les 6 valeurs magiques, gère les ventilations (parent OU sous-lignes) pour `avec` / `sans` / `facsimile`.

- **JustificatifsPage — 5 pills cliquables (extension `justifFilter`)**
  - Type `JustifFilter` étendu : `'all' | 'sans' | 'avec' | 'exempt' | 'locked' | 'facsimile'`. `justifFilter === 'avec'` est maintenant **strict** (exclut les exemptées — alignement EditorPage).
  - `stats` enrichi : `{ total, avec, sans, exempt, locked, facsimile, taux }`. Taux legacy préservé `(avec + exempt) / total` pour la MetricCard existante.
  - 5 pills côte-à-côte à la place du groupe 4-boutons `Tous/Sans/Avec/Fac-simile` : avec vert / sans ambre / exempt sky (si > 0) / locked warning / facsimile violet (si > 0). Comportement toggle identique à EditorPage. Lien « Tout voir » pour reset rapide.
  - `justifFilter === 'facsimile'` détecte aussi les fac-similés dans les sous-lignes ventilées (pas seulement le `Lien justificatif` parent).

- **ManualAssociationDrawer — 3 améliorations UX**
  - **Panneau ops filtre les exemptées** : `useManualAssociation` injecte `appSettings.justificatif_exemptions` via `useSettings()`. Helper `isOpExemptByCategory()` filtre les ops Perso/CARMF/URSSAF/Honoraires dans les 2 branches `mode: 'all'` (single-month + year-wide). Mode `targeted` non filtré (respect du choix manuel). Ops en attente uniquement → pas de faux « manquants ».
  - **Date = calendrier natif** : `<input type="text">` → `<input type="date">` (128px, `color-scheme: dark`). `parseFrDate()` accepte ISO `YYYY-MM-DD` ET legacy `JJ/MM/AAAA`.
  - **Pré-filtre mois Éditeur** : à l'ouverture du drawer, si `month` prop défini → `filterDate = {year}-{MM}-15` + `filterDateTol = 15` → fenêtre couvrant tout le mois. Indépendant de l'op sélectionnée (ancrage stable sur le dropdown Éditeur). Year-wide → filtre date vide.
  - **Drawer élargi quand preview ouvert** : width dynamique 1100 → **1500 px**, panel preview 320 → **600 px** (transition animée `duration-300`). Reste responsive `maxWidth: 98vw`.

- **Éditeur + Justificatifs — sous-lignes ventilées gris foncé**
  - `VentilationLines.tsx` et tr ventilation dans `JustificatifsPage.tsx` : `bg-surface/50` → `bg-black/30` (hover `bg-black/40`). Contraste net avec la row parente, fonctionne sur light + dark sans dépendre des variables de surface.

- **`isOpUnmatched` gère correctement les ventilations**
  - `useRapprochementWorkflow.isOpUnmatched` (hook partagé) : pour une op ventilée, retourne `true` si **au moins une sous-ligne** n'a pas de justif, indépendamment du `Lien justificatif` parent (qui est legacy après association partielle). Fixe le bug « Déjà attribué » qui masquait le bouton Attribuer sur les ops partiellement ventilées comme `DU280125AMAZONPAYMENTSPAYLI/ 202,84` (vl#0 associé, vl#1 et vl#2 vides).

### Added (2026-04-16) — Session 26

- **`ManualAssociationDrawer` — outil d'association manuelle 2-colonnes (op → justif)**
  - Nouveau drawer 1100px dédié aux cas où le `RapprochementWorkflowDrawer` scoré échoue (OCR défaillant ou batch multi-ops). Vue 2-colonnes parallèles **ops | justificatifs** avec panneau preview PDF à gauche coulissant (320px, animation `transition-all duration-250`).
  - **Endpoint** : `GET /rapprochement/{filename}/{index}/suggestions` (format justificatif-centric déjà existant) pour le mode normal ; `GET /justificatifs/?status=en_attente` pour le mode élargi (bypass du pré-filtre ±1 mois backend quand OCR date fausse).
  - **Filtres libres frontend** : date `jj/mm/aaaa` + tolérance ±N jours (défaut 7), montant + tolérance ±N € (défaut 50). Appliqués en `useMemo` après le fetch — les suggestions sans OCR sont conservées (`!best_date → keep`). Toggle « Élargir » masque les filtres et désactive le scoring.
  - **Hook** `useManualAssociation` : modes `targeted` (depuis multi-sélection) / `all` (depuis bouton header), sanitize silencieux des crédits (`montant > 0`), auto-sélection première op, `goToNextOp()` retourne booléen → le composant ferme via `onClose()` en fin de liste. Réutilise `useManualAssociate()` (invalidations déjà branchées).
  - **Row justificatif** : `PdfThumbnail` 32×38px cliquable (toggle preview, règle CLAUDE.md : jamais `<object>` en liste), pill bleu sky date + pill ambre montant avec icônes `CalendarDays`/`Euro`, fallback « n/a » gris italique si OCR absent, `ScorePills` (M/D/F/C + total, masqués en mode élargi), first-row highlight emerald si score ≥ 0.80.
  - **2 points d'entrée** : **JustificatifsPage** (bouton 🔗 header « Association manuelle » toujours visible + bouton « Associer justificatifs (N) » dans la barre flottante batch quand sélection active) et **EditorPage** (icône Link2 header + bouton « Associer justif. (N) » à côté de Snapshot quand `rowSelection > 0`, désactivé en year-wide).
  - **Raccourcis clavier** : ↓↑ navigation liste ops, → skip op courante, Enter associe première suggestion, Esc ferme. Désactivés si focus dans `<input>`.

- **`JustifToOpDrawer` — association sens inverse (justif → op)**
  - Nouveau drawer 1000px ouvert depuis `GedDocumentDrawer` via bouton « Associer à une opération » (visible si `doc.type === 'justificatif' && doc.statut_justificatif === 'en_attente'`). Symétrique de `ManualAssociationDrawer` pour le sens inverse.
  - **Sous-drawer preview PDF grand format** à gauche : `PreviewSubDrawer` avec `width=700`, `zIndex=65` (entre backdrop z-60 et drawer z-70) — le thumbnail cliquable ouvre le PDF en plein écran à gauche au lieu d'un panneau 320px inline. Pattern cohérent avec `OcrEditDrawer` / `ScanRenameDrawer`.
  - **Backend** : `rapprochement_service.get_suggestions_for_justificatif()` étendu pour exposer `op_locked: bool` + `op_locked_at: str|null` dans chaque suggestion (validé utilisateur — alternative préférée à un fetch lazy côté client). Permet d'afficher badge `Lock` warning + bouton « Déverrouiller » sur la row avant l'association.
  - **Édition inline OCR** sous la row justif sélectionnée : 3 inputs (date ISO, montant, fournisseur) + bouton « Appliquer & relancer » → `PATCH /ocr/{filename}/extracted-data` (endpoint existant) → invalidation `['rapprochement-just-suggestions', filename]` → rescoring live visible. Valeurs initiales hydratées depuis `selectedJustif.ocr_date/ocr_amount/ocr_supplier`, `canSaveOcr` = au moins un champ diff vs initial.
  - **Déverrouillage inline par row** : bouton `LockOpen` amber sur chaque op candidate lockée → `UnlockConfirmModal` (prop `zIndex=80` ajoutée) → `useToggleLock` → invalidation des suggestions → bouton « Associer » redevient cliquable sans sortir du drawer.
  - **Self-heal backend** : `ged_service.get_documents()` enrichit dynamiquement `op_locked`/`op_locked_at` pour chaque justificatif `operation_ref`-associé (groupe par fichier pour limiter les loads). Si l'op à `ref.index` ne pointe pas vers le justif (refs désynchronisés après merge/split), le helper `_op_points_to()` scanne le fichier pour retrouver l'op réelle (check `Lien justificatif` parent + ventilation) et corrige l'index dans la réponse.
  - **Navigation** : bouton « Voir » (ExternalLink) sur chaque row → redirect `/justificatifs?file=X&highlight=Y&filter=sans` + `onClose()`. Bouton « Associer » → mutation puis `goToNextJustif()` auto (si dernière → `onClose()`).
  - **Raccourcis** : ↓↑ naviguer panneau gauche, → skip, Enter associe 1ère suggestion si score ≥0.80 et non locked, Esc ferme.

- **`GedDocumentDrawer` — zone actions justificatif enrichie (dissocier + déverrouiller)**
  - Ajout de 2 nouveaux boutons dans la zone danger à côté de « Supprimer » (visibles conditionnellement) :
    - **« Dissocier de l'opération »** (amber, `Unlink`) — visible si `operation_ref` présent, désactivé si `op_locked` avec tooltip explicatif « déverrouillez d'abord ». Appelle `useDissociate` + invalide `ged-documents`/`ged-stats`/`ged-tree` au succès. Gère le 423 backend avec toast dédié.
    - **« Déverrouiller l'opération »** (warning, `LockOpen`) — visible si `op_locked === true`. Ouvre `UnlockConfirmModal` (zIndex 80) → `useToggleLock({ locked: false })` → invalide `ged-documents` pour rafraîchir le flag.
  - Layout 2 lignes : ligne 1 avec Dissocier + Déverrouiller (flexwrap), ligne 2 avec Supprimer (inchangé). Permet de gérer tout le lifecycle d'un justif associé directement depuis la GED sans détour par l'éditeur.
  - **Prop `zIndex` ajoutée** à `UnlockConfirmModal` (`z-[60]` hardcodé remplacé par `style={{ zIndex: zIndex ?? 60 }}`) pour permettre l'empilement sur un drawer parent lui-même en z-50+ (ex. GedDocumentDrawer).

- **GedDocumentCard / List — badges enrichis + tri colonnes**
  - **Vue grille** (`GedDocumentCard.tsx`) : badge « Associé » bascule de vert à **orange** `#FFE6D0`/`#C2410C`/`#F59E0B` (conforme demande utilisateur). Nouveau badge **« Verrouillé »** (`Lock` icon, warning) empilé sous « Associé » top-right si `doc.op_locked === true`. Info-panel bas refondu : ligne 1 = pill montant ambre (`Euro`) + pill date sky (`CalendarDays`), ligne 2 = pill catégorie primary (`Tag`) + pill fournisseur lilas `bg-purple-500/15` (`Building2`). Badges homogènes avec `ManualAssociationDrawer` / `JustifToOpDrawer`.
  - **Vue liste** (`GedDocumentList.tsx`) refondue : **7 colonnes** Nom / Type / Date / Catégorie / Fournisseur / Montant / Statut. Poste comptable repositionné en sous-ligne du nom. Colonne Statut avec pills multi (En attente beige, Associé orange, Verrou warning, empilables). Composant interne `SortableHeader` : headers cliquables avec icône `ArrowUpDown` grise au repos, `ArrowUp`/`ArrowDown` primary color quand active. Clic même colonne → toggle asc/desc ; clic autre → switch + reset desc.
  - **Header GedPage** : nouveau sélecteur `<select>` de tri avec 8 options (Date ajout / Date document / Nom / Type / Catégorie / Fournisseur / Montant / Statut) + bouton toggle asc/desc (`ArrowUp`/`ArrowDown`) placé avant le toggle grille/liste. Sync bidirectionnel avec les headers triables via `filters.sort_by` / `filters.sort_order`.
  - **Backend** `ged_service.py` : `get_documents()` tri refait pour **None safety** (sépare docs avec valeur et None → None en fin asc ET desc). Support des paths pointés (`period.year`). Fallbacks montant consolidé `montant || montant_brut` et date `date_document || date_operation || period.year`. Helper `_extract_value` + `try/except` coerce string sur types hétérogènes.

### Fixed (2026-04-16) — Session 26

- **Lock cellule Éditeur impossible sur certaines ops (décembre 2025 PRLVSEPAFCEBANK 1443,55 + autres)**
  - **Cause racine** : les champs internes frontend `_sourceFile` / `_index` (ajoutés par `useYearOperations` en mode year-wide pour supporter l'édition cross-file) avaient été **persistés dans les fichiers JSON** lors d'un save antérieur. Après les scripts `split_multi_month_operations.py` / `merge_overlapping_monthly_files.py` passés sur ces fichiers, les `_sourceFile` pointaient vers des fichiers sources **disparus** (ex. `operations_20260413_185158_275b0690.json`). Chaque clic Lock PATCH-ait vers ce fichier fantôme → **HTTP 404 silencieux**, l'op réelle dans `operations_merged_202512_*.json` n'était jamais modifiée.
  - **3 fixes** :
    - `EditorPage.tsx` (cellule lock) — utilise désormais `Number(row.id)` (index dans data array source, insensible au tri/filtre/pagination) au lieu de `row.index` (position visible post-filtre/tri). En mode single-file, on **ignore explicitement** `op._sourceFile` et `op._index` (on prend toujours `selectedFile`) — seul le mode year-wide les consulte.
    - `handleSave` — nettoie `_sourceFile` et `_index` de chaque op via spread destructuring avant envoi au backend — garantit que les fichiers ne se polluent plus.
    - Script one-shot : **572 champs `_sourceFile`/`_index` purgés dans 13 fichiers** existants (`operations_merged_*` + `operations_split_*`).
  - **Test end-to-end** : lock via UI → toast succès → fichier JSON contient `"locked": true, "locked_at": "2026-04-16T19:04:51"` + aucun champ résiduel.

- **`/api/ged/tree` 500 → arbre GED vide dans la sidebar**
  - **Cause** : `ged_service.py:928` faisait `period.get("month", 1) - 1` alors que `period.get("month")` retournait `None` (pas `1`) quand la clé existe avec valeur `null` dans `ged_metadata.json` — défaut Python. Puis `None - 1` → `TypeError: unsupported operand type(s) for -: 'NoneType' and 'int'`.
  - **Fix** : `month_val = period.get("month") or 1` explicite avant le calcul du trimestre. L'arbre se repeuple correctement (5 années visibles : 2026 / 2025 / 2024 / 2022 / Non daté).

- **`api.post` / `api.patch` : `Content-Type` conditionnel au body**
  - `frontend/src/api/client.ts` — le header `Content-Type: application/json` n'est plus envoyé quand `options?.body` est `undefined`/`null`. Avant, POST sans body → header envoyé → FastAPI/Starlette interprétait comme JSON malformé → 400 custom. Cas typique : `POST /api/ml/train`.

### Added (2026-04-16) — Session 25

- **Note de frais — badge + champ `source` + split button `+ Ligne ▾`**
  - **Backend** : champ `source: Optional[str] = None` sur `Operation` (backend/models/operation.py) — valeurs connues `"note_de_frais" | "blanchissage" | "amortissement" | None`. Round-trip transparent car les ops sont sauvegardées en raw dict via `json.dump` (pas de `model_dump`). Aucune migration nécessaire (champ optionnel, backward-compatible).
  - **Frontend** : type `Operation.source?: string`. Badge pill amber `#FAEEDA` / `#854F0B` (miroir du badge « Mal nommé ? Éditer OCR » du GedDocumentDrawer) affiché au-dessus de la cellule Catégorie si `op.source === 'note_de_frais'`. Read-only — pas d'édition du champ depuis l'UI. Propagé dans **3 pages** : EditorPage (cellule Catégorie), JustificatifsPage (cellule Catégorie), AlertesPage (cellule Libellé, au-dessus du texte).
  - **Split button `+ Ligne ▾`** dans EditorPage : remplace le bouton unique `+ Ligne`. Structure = bouton principal + chevron séparé. Clic principal → `addRow()` (op bancaire classique) ; clic chevron → dropdown 2 options (« Opération bancaire » / « Note de frais (CB perso) » avec badge intégré). `addRow(source?: string)` propage le champ dans le dict créé via spread conditionnel (évite `source: undefined` qui serait dumpé en `null`). State `addMenuOpen` + `addMenuRef` + `useEffect` click-outside. Masqué en year-wide (`{!allYearMode && ...}`).
  - **Filtre « Type d'opération »** dans 4 pages :
    - **Éditeur** : dropdown dans le panneau Filtres (grille passée de 5 → 6 cols), via colonne cachée `id: 'source'` avec `columnVisibility: { source: false }` + `filterFn` custom sur `__CREATE_N__`/`bancaire`/`note_de_frais`. Compatible avec les autres filtres TanStack (Catégorie / Sous-catégorie / Non catégorisées).
    - **Justificatifs** : `sourceFilter: 'all' | 'bancaire' | 'note_de_frais'` dans `useJustificatifsPage.ts`, `<select>` dans la toolbar à côté du filtre sous-catégorie, reset inclus dans le bouton X (réinit category + subcategory + source). Style amber quand actif (`border-amber-500/50 text-amber-400`). Auto-clear sélection `selectedOps` sur changement de filtre.
    - **Rapports** : 3 pills `Tous / Opérations bancaires / Notes de frais uniquement` dans `ReportFilters.tsx`, badge amber intégré dans le 3ᵉ pill. Backend : param `source` sur `ReportFilters` Pydantic, filtrage dans `_apply_filters` (report_service) après le type débit/crédit.
    - **Compta Analytique** : widget `RepartitionParTypeCard` après `KPIRow` avec 2 cartes (Opérations bancaires vs Note de frais) + share% « X.X% des dépenses en notes de frais ». Backend : `by_source: [{source, debit, credit, count}]` retourné par `analytics_service.get_dashboard_data()` via groupby pandas sur colonne `source` (fillna → "bancaire").
  - **Workflow end-to-end validé** : créer une op via split button → clic « Note de frais (CB perso) » → ligne insérée top du tableau avec badge amber → save → disque contient `"source": "note_de_frais"` → reload → badge persiste → filtre Type d'opération → n'affiche que cette ligne + bandeau TOTAL filtré.

- **Fichier mensuel vide à la demande (débloque saisie NDF sans relevé importé)**
  - **Problème résolu** : pour saisir une note de frais CB perso en mars/avril 2026, il fallait que le relevé bancaire PDF soit déjà importé (sinon aucun fichier `operations_*.json` à éditer). Bouchon UX pour les NDF qui par nature ne passent pas par la banque.
  - **Backend** : fonction `operation_service.create_empty_file(year: int, month: int) -> str` crée un fichier vide `operations_manual_YYYYMM_<hex8>.json` dans `IMPORTS_OPERATIONS_DIR`. Préfixe `manual_` pour traçabilité. Hash aléatoire 8 chars via `secrets.token_hex(4)` pour éviter les collisions. Garde `1 ≤ month ≤ 12`.
  - **Endpoint** `POST /api/operations/create-empty` avec body `CreateEmptyMonthRequest {year, month}` → `{filename, year, month}`. Route déclarée **avant** les routes dynamiques (`/{filename}`) pour éviter la collision FastAPI.
  - **Listing intelligent** : `operation_service._file_meta` enrichi avec un fallback regex sur le filename (`r"_(\d{4})(\d{2})_"`) pour dériver `year` + `month` quand le fichier est vide (pas d'ops pour agréger le mois dominant). Permet au dropdown d'afficher `Mars (0 ops)` immédiatement après création.
  - **Frontend** : hook `useCreateEmptyMonth()` (useOperations.ts) → `api.post('/operations/create-empty', {year, month})` avec invalidation de `['operation-files']`.
  - **EditorPage** : dropdown mois refondu pour exposer les **12 mois** même sans fichier. Mois avec fichier → `{MOIS_FR[m-1]} ({count} ops)`, mois sans → `{MOIS_FR[m-1]} — vide · créer` avec valeur `__CREATE_N__`. Sélection → `window.confirm("Aucun relevé pour {Mois} {Year}. Créer un fichier d'opérations vide pour ce mois ?")` → sur confirmation : `createEmptyMonth.mutateAsync({year, month})` → auto-select du nouveau filename + toast succès.
  - **Intégration NDF** : une fois le fichier vide créé, le split button `+ Ligne ▾ → Note de frais (CB perso)` fonctionne immédiatement. Quand le relevé bancaire sera importé plus tard pour le même mois, les scripts `split_multi_month_operations.py` + `merge_overlapping_monthly_files.py` gèrent la fusion par hash op-identité.

- **Ligne TOTAL synthétique sticky dans JustificatifsPage (miroir Éditeur)**
  - Réplique le pattern `<tr>` synthétique de l'Éditeur : sticky bottom-0 z-20, bordures `border-y-2 border-warning` + gradient warning + symbole ∑, compteur d'ops filtrées, Débit rouge tabular-nums, Crédit vert, Solde dans pill colorée (`bg-success/20` emerald ou `bg-danger/20` rouge selon signe). 9 cellules alignées avec le thead (checkbox / Date / Libellé / Débit / Crédit / Catégorie / Sous-cat / Justif / Verrou).
  - Condition d'affichage : `filtersActive = categoryFilter !== '' || subcategoryFilter !== '' || sourceFilter !== 'all' || justifFilter !== 'sans' || search.trim() !== ''`. Visible uniquement quand au moins un filtre narrowing est actif (pas en état par défaut — les MetricCards du haut suffisent). Clamp `count > 0` pour éviter la ligne vide.
  - `filteredTotals` calculé dans un `useMemo` sur `operations` (sortie du hook, déjà filtré). Jamais sauvegardé (rendu post-`.map`, pas ajouté au state React).

- **Tâche Kanban auto `ml_retrain` + Toast cerveau animé (MLRetrainToast)**
  - **6e détection auto** dans `task_service.generate_auto_tasks(year)` : compte les corrections manuelles postérieures au dernier entraînement via helpers `_count_corrections_since_last_training()` (scan `data/ml/logs/corrections/corrections_*.json` filtré par timestamp > last training) + `_days_since_last_training()` (diff `datetime.now() - last_ts`).
  - **Seuils configurables dans Settings** : `ml_retrain_corrections_threshold: int = 10` + `ml_retrain_days_threshold: int = 14` sur `AppSettings` (Pydantic + TS). Helper `_load_ml_retrain_thresholds()` lit settings.json avec fallback sur les défauts.
  - **Condition de déclenchement** : `corrections_count >= corrections_threshold` OR `(corrections_count >= 1 AND days_since_training >= days_threshold)`. Priorité `haute` si `corrections_count >= 2 × threshold`, sinon `normale`.
  - **Champ `metadata: Optional[dict]`** ajouté au modèle `Task` (backend Pydantic + frontend TS) — contient `corrections_count`, `days_since_training`, `action_url: "/agent-ai"`. Optionnel et backward-compat (absent sur les tâches existantes).
  - **Composant `MLRetrainToast.tsx`** (frontend/src/components/shared/) : card 360px, accent gauche violet `#7F77DD`, icône cerveau SVG entourée de 2 anneaux pulsants décalés (0s / 0.7s) via `@keyframes ml-pulse-ring`. 2 pills : corrections (violet `#EEEDFE`/`#534AB7`) + jours (amber `#FAEEDA`/`#854F0B`). 2 boutons : primary violet `Entraîner maintenant` (navigate → `/agent-ai`) + ghost `Plus tard`. Bouton X persistant. Animations `animate-enter`/`animate-leave` cohérent avec SandboxArrivalToast.
  - **Keyframes CSS** (index.css) : `ml-pulse-ring` (scale 0.88→1.18 + opacity 0.7→0), `ml-toast-progress` (width 100%→0%), `ml-neuron-blink` (3 étapes scale+opacity).
  - **Déclenchement AppLayout** : useEffect + `useTasks(selectedYear)` + gate sessionStorage `'ml-retrain-toast-shown'` → affiche le toast **1× par session** en `top-right` avec `duration: Infinity` (persiste jusqu'au clic). `useRef mlToastShown` en complément pour éviter la double exécution en mode Strict React. Vérification stricte : skippé si `metadata.corrections_count <= 0`.
  - **UI Settings** : 2 inputs number dans GeneralTab (min=1 max=500 pour corrections, min=1 max=365 pour days) avec icône Brain, description explicative, séparateur top-border.

- **ML — Bulk-import training depuis opérations catégorisées (`/ml/import-from-operations`)**
  - **Service** : `ml_service.import_training_from_operations(year: Optional[int])` scanne `data/imports/operations/*.json` (filtrage année via le champ `Date` plutôt que le filename pour gérer les fichiers merged multi-mois), applique `clean_libelle` + filtre les catégories exclues (`""`, `"Autres"`, `"Ventilé"`, `"perso"`, `"Perso"`), explose les ventilations en sous-exemples individuels, puis délègue à `add_training_examples_batch` (dédup par `(libelle, categorie)`) + `update_rules_from_operations` (exact_matches). Retourne `{files_read, ops_scanned, ops_skipped, vent_sublines, examples_submitted, examples_added, rules_updated, total_training_data, year_filter}`.
  - **Endpoint** `POST /api/ml/import-from-operations?year=...` (year optionnel, omis = toutes années).
  - **UI ActionsRapides.tsx** : section « Importer données historiques » entre Entraîner+Appliquer et Sauvegarder, bouton bleu `Database` avec mutation + toast + block résultat 8 métriques (fichiers lus, ops scannées, ops ignorées, sous-lignes ventil., exemples soumis, nouveaux dédup +N, règles maj, total corpus). Réutilise `allYears` + `selectedYear` pour cohérence UX avec Entraîner+Appliquer.
  - **Hook** `useCreateEmptyMonth` → invalide `['ml-model']` + `['ml-model-full']` + `['ml-training-data']`.

- **ML — Feedback UI erreur entraînement**
  - `ActionsRapides.tsx` : nouveau bloc `{trainResult && !trainResult.success && (...)}` affichant `<XCircle /> Entraînement échoué — vérifier les logs backend` sous le bouton principal, à côté du feedback existant `{trainMutation.isError && ...}` (cas network error).

### Changed (2026-04-16) — Session 25

- **ML — Migration `LogisticRegression` → `LinearSVC` (CalibratedClassifierCV wrapper)**
  - `train_sklearn_model()` : remplace `LogisticRegression(max_iter=1000, class_weight="balanced")` par `CalibratedClassifierCV(LinearSVC(max_iter=2000, class_weight="balanced", dual=True), cv=2)`. LinearSVC est plus performant sur les corpus courts TF-IDF à faible signal (libellés bancaires 3-5 mots, ~20 classes, 250-500 exemples).
  - `CalibratedClassifierCV` enveloppe le SVM pour exposer `.predict_proba()` (requis par `evaluate_hallucination_risk()` qui calcule la confidence via `probas[idx]`). Sans wrapper, LinearSVC n'a pas nativement cette méthode.
  - `cv=2` : seuil minimal ops/classe relevé de `<2` → `<3` (filtrage en amont) pour garantir qu'après `train_test_split(test_size=0.25, stratify=y)` chaque classe ait ≥2 exemples en train. Les 4 classes à 2 exemples (CARMF, Poste, Alimentation, Ordre des Médecins) sont écartées du fit sklearn mais restent fonctionnelles via `exact_matches` rules-based (priorité sur sklearn dans le pipeline de prédiction).
  - `unique_classes` capturé **après** les 2 filtres (perso + too_few) pour que `n_classes`/`labels`/`confusion_matrix` reflètent fidèlement ce qui a été appris.
  - Backup pré-migration créé via `create_backup()` (`model_backup_20260416_102421_manuel`). Anciens pkls purgés avant le re-fit.

- **ML — `avg_confidence` + `confidence_distribution` restreints aux prédictions sklearn**
  - `ml_monitoring_service.get_monitoring_stats()` : calcule désormais `avg_confidence` et `confidence_distribution` **uniquement** sur `sklearn_preds = [p for p in all_preds if p.source == "sklearn"]`. Les prédictions rules-based (`keywords`/`exact_match`) ont leur confidence **hard-codée à 1.0** dans `categorize_file()` — les inclure créait un artefact trompeur affichant ~100% confiance alors que le modèle sklearn réel est à ~7%.
  - `hallucination_count` + `unknown_count` calculés aussi sur `sklearn_preds` uniquement (cohérent).
  - Impact mesuré : `avg_confidence` passé de 1.0 (artefact) à 0.069 réel. Distribution passe de `4203/0/6` à `0/0/6` (toutes les prédictions sklearn tombent en basse confiance — signal fiable pour décider d'enrichir le corpus ou pas).

- **ML — Router `/ml/model` enrichit `stats` depuis les logs réels**
  - `backend/routers/ml.py:get_model()` : agrège `ml_monitoring_service._load_all_prediction_logs()` + `_load_all_corrections()` pour exposer les VRAIES métriques `operations_processed` et `success_rate = 1 - correction_rate`. Le champ `stats.operations_processed` dans `model.json` était initialisé à 0 dans `_empty_model()` et **jamais incrémenté** → jauge dashboard `Ops traitées` restait à 0 perpétuellement.
  - Résultat : la jauge affiche désormais 4209 ops traitées + 95.3% success_rate (vs 0 / 0% avant). Fallback silencieux sur `model.json` si monitoring indisponible (try/except).

- **ML — `categorize_file()` respecte maintenant `op.locked`**
  - Ajout d'un `if op.get("locked"): continue` en tête de boucle **avant** le check `empty_only`. Cohérent avec `run_auto_rapprochement()` qui applique la même garde depuis plus longtemps. Protège mode `empty_only` ET mode `all` contre l'écrasement silencieux par la prédiction ML.
  - Bug avant : bouton « Recatégoriser IA » (mode=all) dans l'Éditeur balayait la Catégorie + Sous-catégorie de TOUTES les ops, y compris celles manuellement associées à un justificatif (qui sont auto-lockées par `associate_manual`). Le lock protégeait contre l'auto-rapprochement mais pas contre la recatégorisation ML. Fix aligne les 2 chemins.
  - Test validé sur fichier réel : `modified: 85, total: 86` → exactement 1 op (lockée en `TEST_LOCKED_CAT`) épargnée ; avant le fix les 86 auraient été écrasées.

- **ML — Post-override pro → perso dans `predict_category()`**
  - Nouvelle clé `perso_override_patterns: list[str]` dans `model.json` (ex. `["eats", "ubereats", "levoltaire", "benrvac", "motifrevac", "succursale"]`). Si la prédiction initiale (rules + keywords) tombe dans une classe pro ambiguë (`Matériel`, `Fournitures`, `Repas pro`, `Transport`, `Alimentation`) OU est `None`, et que le libellé clean contient un des patterns → force override en `perso`.
  - Résout les ambiguïtés marque-scope : « UBEREATS » prédit initialement `Transport` via le keyword `uber`, l'override le rebascule en `perso` car le libellé contient `eats`. De même « LEVOLTAIRE » (restaurant perso récurrent) → perso même sans keyword.
  - Garde défensive : override s'applique **jamais** sur une prédiction non-ambiguë (Remplaçant, URSSAF, CARMF, Honoraires, etc.) pour éviter les faux positifs.

- **Métriques modèle ML — +34 keywords + 6 patterns perso → accuracy règles 27% → 90.1%**
  - Analyse des corpus par catégorie a identifié les tokens discriminants non-locaux et non-génériques : `openai/chatgpt/mistral` → Abonnements, `carmf` → CARMF, `urssaf` → URSSAF, `orange/sfr/bouygues/free` → Telephone-Internet, `netflix/spotify/disney` → Loisirs, `total/station/essence/carburant/peage/qpf` → Véhicule, `auchandac` → Véhicule (protège contre les variantes futures hors Montauban), etc. 34 keywords ajoutés dans 14 catégories.
  - Benchmark sur corpus complet (1188 ops catégorisées) : **90.1% correctes via règles+keywords+override** (vs baseline sklearn ~27%). 0 fallback sklearn car les règles couvrent 100% des libellés connus. Les 9.9% d'erreurs restantes sont des cas où un keyword trop large (ex. `amazonpayments` dans Fournitures) capture un libellé perso — à raffiner par extension des `perso_override_patterns` ou réduction des keywords.

- **Frontend — `api.post`/`api.patch` : Content-Type conditionnel au body**
  - `frontend/src/api/client.ts:3-15` : la fonction `request()` ne force plus `Content-Type: application/json` quand `options?.body` est `undefined` ou `null`. Avant : un POST sans body envoyait le header → FastAPI/Starlette interprétait comme JSON malformé (ou certains proxies rejetaient avec 400). Maintenant : si pas de body, pas de Content-Type → le backend traite la requête comme un POST sans body attendu (comportement standard pour `POST /api/ml/train` qui n'attend pas de body).
  - Bug reproduit : `POST /api/ml/train` depuis le frontend → 400 (Content-Type JSON + body vide), depuis curl → 200 (pas de Content-Type). Fix aligne les 2 chemins.
  - Non-régression : `api.post('/ml/predict', {libelle: "..."})` continue d'envoyer `Content-Type: application/json` correctement (body est présent).

- **Frontend — Type `TrainResult` aligné avec le backend (`acc_train` au lieu de `accuracy_train`)**
  - `frontend/src/types/index.ts` : champs `accuracy_train` / `accuracy_test` renommés en `acc_train` / `acc_test` pour refléter ce que le backend renvoie réellement. Bug latent : `ActionsRapides.tsx` lisait `trainResult.metrics.accuracy_train` → `undefined` → `(undefined * 100).toFixed(1) = NaN%`. Masqué par le bug 400 (l'UI n'atteignait jamais le rendu), révélé après le fix.
  - Ajout aussi de `n_samples?`, `n_classes?`, `labels?` sur l'interface pour cohérence avec le dict retourné.

- **Frontend — Fix 400 sur `POST /api/ml/train` + feedback erreur**
  - Cascade de fixes (voir `Changed` ci-dessus) : Content-Type conditionnel + `class_weight='balanced'` + filtre perso + feedback UI. Le bouton « Lancer l'entraînement » fonctionne à nouveau, affiche un badge vert avec les 4 métriques (acc_train, acc_test, f1, précision) ou un badge rouge en cas d'échec.

- **DevX — `start.sh` : flags uvicorn pour éviter les reloads bloqués**
  - Ajout `--timeout-graceful-shutdown 2` : force le kill du worker après 2 secondes même si des connexions SSE (`/api/sandbox/events`), le thread watchdog Observer ou la tâche `_previsionnel_background_loop` n'ont pas terminé proprement. Sans ce flag, le reload restait bloqué indéfiniment sur `Waiting for connections to close` → utilisateur forcé au Ctrl+C + relance manuelle.
  - Ajout `--reload-exclude 'data/*' 'frontend/*' '*.pkl' '*.log' 'backups/*' '__pycache__/*'` : évite les reloads parasites déclenchés quand le backend lui-même écrit dans `data/` (ex. `save_rules_model`, `log_prediction_batch`). Seuls les changements sur `backend/**/*.py` déclenchent désormais un reload.

### Fixed (2026-04-16) — Session 25

- **`get_batch_justificatif_scores` — propagation `override_sous_categorie`**
  - `backend/services/rapprochement_service.py:1094-1139` : la boucle de scoring des justificatifs en attente (pour la galerie) itérait sur les sous-lignes de ventilation mais ne passait **pas** `override_sous_categorie` à `compute_score()`, contrairement à sa fonction sœur `get_batch_hints()` (ligne 1064) qui le faisait correctement. Asymétrie silencieuse : sur les ops ventilées, le score catégorie pouvait retomber de 1.0 (cat match + sub match) à 0.6 (cat match + sub mismatch), faisant potentiellement basculer des matches sous le seuil 0.60 dans la galerie alors qu'ils étaient au-dessus dans le drawer.
  - Fix : tuple `all_targets` étendu de 5 → 6 éléments (ajout de `override_sous_categorie`), boucle de scoring réécrite pour propager le paramètre à `compute_score()`. Le paramètre existait déjà dans la signature (ligne 312). Aucun changement public de `compute_score()` ni `get_batch_hints()`. Test sur corpus réel : 58 entrées retournées, scores stables entre 2 exécutions consécutives, top matches (cursor, udemy, ford-credit, boulanger, ldlc, amazon) conformes aux attentes.

- **Frontend — Suppression du drawer legacy `JustificatifDrawer.tsx`**
  - `frontend/src/components/justificatifs/JustificatifDrawer.tsx` supprimé (~500 LOC legacy). Audit grep a confirmé **zéro import** dans `frontend/src`. Le drawer actif est `RapprochementWorkflowDrawer` (700px unifié avec 2 modes, intégration complète avec `useRapprochementWorkflow`). Les 3 bugs résiduels du fichier legacy (handleDissociate cassé avec `operation_file=""` et `operation_index=0`, `score_detail` affiché comme `[object Object]`, pas de gestion HTTP 423) n'affectaient personne car le code n'était pas exécuté. Suppression directe plutôt que patch — évite qu'un futur refactor réutilise le composant buggé par erreur.

### Security / Data integrity (2026-04-16) — Session 25

- **Nouveau champ `source` ne rompt pas le round-trip JSON**
  - Le champ `source: Optional[str]` ajouté sur `Operation` est persisté via `json.dump(operations, f)` (raw dict, pas `model_dump`) — toute valeur présente dans le dict est conservée sans validation Pydantic stricte. Les ops sans `source` (toutes les ops historiques) restent intouchées. Les ops avec `source: "note_de_frais"` round-trip proprement (save → load → save) sans perte.
  - Vérification explicite : créer une NDF dans l'Éditeur, save, reload la page → le badge persiste, `source` visible dans le JSON sur disque.

- **`categorize_file` respecte `locked` — aucune perte silencieuse de catégorie manuelle**
  - Avant Session 25, un clic sur « Recatégoriser IA » (mode=all) dans l'Éditeur écrasait la Catégorie + Sous-catégorie de **toutes** les ops, y compris celles manuellement associées à un justificatif. Le lock posé par `associate_manual` protégeait contre `run_auto_rapprochement` mais pas contre `categorize_file`. Impact sur la session courante : aucun — le bug est corrigé avant que ce chemin n'ait été déclenché massivement en production.

---



- **Bulk-lock + bulk-unlock des associations (JustificatifsPage + EditorPage)**
  - **Backend** : endpoint `PATCH /api/operations/bulk-lock` (`backend/routers/operations.py`) avec 4 modèles Pydantic (`BulkLockItem`, `BulkLockRequest`, `BulkLockResultItem`, `BulkLockResponse`). Groupe les items par `filename` via `itertools.groupby` → un seul `load_operations` + `save_operations` par fichier. Erreurs par-item (fichier introuvable / index hors bornes) remontées dans `results[i].error` sans stopper le batch. Route déclarée **avant** `PATCH /{filename}/{index}/lock` pour éviter la collision FastAPI (`filename="bulk-lock"` matcherait sinon la route paramétrée).
  - **Hook** `useBulkLock` (`frontend/src/hooks/useBulkLock.ts`) : mutation `api.patch('/operations/bulk-lock', {items})` + invalidation des queries `['operations', filename]` pour chaque filename unique + `['justificatifs']`.
  - **Composant** `BulkLockBar` (`frontend/src/components/BulkLockBar.tsx`) : barre flottante bottom-6 (ou bottom-24 si décalée pour coexister avec une autre barre), toggle intelligent Verrouiller (icône `Lock` + bg warning) ↔ Déverrouiller (icône `LockOpen` + bg emerald) selon l'état `allLocked` des ops sélectionnées. Spinner `Loader2` pendant mutation, bouton `×` pour annuler.
  - **JustificatifsPage** : ajout d'une **2ᵉ sélection indépendante** `lockSelectedOps` dans `useJustificatifsPage.ts` (parallèle à `selectedOps` utilisé pour batch fac-similé). Helpers : `lockableOps` (ops avec justif + non exemptées + parent non-ventilé), `toggleLockSelection`, `toggleAllLockSelection`, `clearLockSelection`, `lockSelectedCount`, `isAllLockSelected`, `isSomeLockSelected`, `lockSelectedAllLocked`. Reset au changement de filtre/mois (même effet que `selectedOps`).
  - **JustificatifsPage UI** : nouvelle colonne « Verrou » dédiée, séparée de la colonne Justif. Header = bouton 🔒 cliquable (icône `Lock` 14px) avec feedback visuel trois états (repos gris hover warning, sélection partielle ring warning/40, tout sélectionné ring warning/60). Cellule : 3 modes — (1) non lockable → rien, (2) mode sélection active → checkbox 22px warning, (3) repos → `LockCell` **cliquable** + petite checkbox 18px au hover à côté (grâce à `group` sur `<tr>`). `shifted={selectedCount > 0}` sur la BulkLockBar pour coexister avec `BatchReconstituerBar`.
  - **EditorPage** : même UX miroir. Colonne `id: 'locked'` refactorée (size 44px) — header 🔒 masqué en `allYearMode`, cellule swap LockCell ↔ checkbox 22px warning en sélection active, hover avec checkbox 18px à côté du LockCell au repos. `shifted={false}` (pas de BatchReconstituerBar dans l'éditeur). Masqué complètement en year-wide (`{!allYearMode && <BulkLockBar .../>}`) puisque year-wide = lecture seule. Classe `group` ajoutée au `<tr>` parent + highlight row sélectionnée (`bg-warning/10`).
  - **Toggle intelligent** : handler `handleBulkLock` calcule `targetLocked = !lockSelectedAllLocked` — si toutes les ops sélectionnées sont déjà verrouillées → on déverrouille, sinon → on verrouille (homogénéise les mix). Toast adaptatif : `"3 verrouillées"` / `"3 déverrouillées"` + détail des erreurs partielles.

- **Éditeur — Bandeau stats filtrées en haut de table**
  - Zone entre le bandeau `filterUncategorized` et les headers : affiche `{N} opération(s) filtrée(s)` + `sur {total} totales` + Débits (rouge) + Crédits (vert) + Solde (vert/rouge selon signe)
  - Calculé depuis `table.getFilteredRowModel().rows` en live (recalcul à chaque tap)
  - Visible uniquement si `filtersActive && filteredRows.length !== operations.length` : évite le doublon avec le footer de pagination quand le filtre n'est pas effectif

- **Éditeur — Ligne TOTAL éphémère en bas de table (sticky)**
  - `<tr>` synthétique injecté après `tbody.rows.map` mais **jamais sauvegardé** : calcule Débit/Crédit/Solde depuis les `filteredRows` TanStack
  - Style distinctif : `sticky bottom-0 z-20`, bordures orange `border-y-2 border-warning`, `border-l-4 border-r-4` sur la première et dernière cellule → effet encadré, gradient `from-warning/30 via-warning/25 to-warning/30`, shadow vers le haut (`shadow-[0_-6px_16px_-4px_rgba(245,158,11,0.5)]`)
  - Symbole ∑ en 16px + « Total » uppercase tracking-wider en orange, Libellé = compteur italique orange/80, montants tabular-nums, Solde dans une **pill colorée** (`bg-success/20 text-success ring-1 ring-success/40` ou `bg-danger/...` selon signe)
  - Même condition d'affichage que le bandeau (filtre actif + effectif)

- **Snapshots — sélections nommées d'opérations réutilisables**
  - **Backend**
    - `backend/models/snapshot.py` : `SnapshotOpRef(file, index)`, `Snapshot(id, name, description?, color?, ops_refs, context_year?, context_month?, context_filters?, created_at, updated_at?)`, `SnapshotCreate`, `SnapshotUpdate`
    - `backend/services/snapshot_service.py` : CRUD sur `data/snapshots.json` (structure `{snapshots: [...]}`), helpers `_op_hash`, `_build_active_hash_index`, `_try_repair_ref_via_archive`. `resolve_snapshot_ops(id)` charge les ops réelles via `(file, index)`, avec **auto-réparation** transparente des refs cassées : si le fichier source n'existe plus (ex. archivé par split/merge), charge l'archive `_archive/{file}.bak_*` → hash l'op à l'ancien index → cherche le même hash dans les fichiers actifs → met à jour la ref et persiste dans `snapshots.json`
    - `backend/routers/snapshots.py` : `GET /`, `GET /{id}`, `GET /{id}/operations`, `POST /`, `PATCH /{id}`, `DELETE /{id}`. Router préfixe `/api/snapshots`, monté dans `main.py`
    - Config : `SNAPSHOTS_FILE = DATA_DIR / "snapshots.json"` dans `backend/core/config.py`
  - **Frontend**
    - `frontend/src/hooks/useSnapshots.ts` : 5 hooks (`useSnapshots`, `useSnapshot`, `useSnapshotOperations`, `useCreateSnapshot`, `useUpdateSnapshot`, `useDeleteSnapshot`) avec invalidation croisée
    - `SnapshotCreateModal` (440px modal centrée) : input nom avec **pré-remplissage contextuel intelligent** (combine mois/année + filtre catégorie + recherche globale + count — ex. `"Novembre 2025 — Véhicule — (14 ops)"`), description optionnelle, picker 6 couleurs (violet/bleu/vert/orange/rose/rouge). Raccourci `Cmd+Enter` pour valider. Clear de la sélection TanStack après création
    - `SnapshotsListDrawer` (520px à droite) : grille de cartes avec pastille couleur + titre + description + `{N} ops` + date + contexte year/month. Hover actions : Voir + Supprimer (avec confirmation inline rouge)
    - `SnapshotViewerDrawer` (760px à droite) : header avec pastille couleur + titre **renommable inline** (icône crayon au hover → input + blur/Enter = save), 4 stats (Ops, Débits, Crédits, Solde) avec badge ambre « N refs cassées » si applicable, tableau des ops réelles avec colonne Actions (bouton `ExternalLink` → `/editor?file=X&highlight=Y` + fermeture drawer)
    - `SnapshotsPage` (`/snapshots`) : page dédiée avec `PageHeader`, grille responsive 1/2/3 colonnes de cartes, CTA « Créer dans l'éditeur » si vide. Chaque carte `SnapshotCard` utilise `useSnapshotOperations` pour afficher stats live (ops/débits/solde), confirmation suppression inline, couleur en bordure top 3px
    - Sidebar : item « Snapshots » (icône `Camera`) ajouté dans le groupe **OUTILS** (entre Tâches et Agent IA)
    - Route `<Route path="/snapshots" element={<SnapshotsPage />} />` dans `App.tsx`
    - **EditorPage** : 2 boutons dans le header actions — (1) 📷 « Mes snapshots » toujours visible → ouvre `SnapshotsListDrawer`, (2) 📷 « Snapshot (N) » **visible uniquement** si `selectedCount > 0 && !allYearMode` (bg warning) → ouvre `SnapshotCreateModal`. `selectedOpsRefs` construit depuis `rowSelection` TanStack avec `Number(rowId)` (= index dans le fichier source, **pas** `row.index` qui est la position filtrée)

- **Scripts de maintenance données**
  - `scripts/split_multi_month_operations.py` : éclate un fichier d'opérations multi-mois en N fichiers mensuels. Mode `--dry-run` par défaut, `--yes` pour exécuter. Groupe les ops par YYYY-MM (clé `Date`), crée `operations_split_YYYYMM_<ts>.json` pour chaque mois, rebinde les refs GED + OCR (clés `file`/`index`), archive le source dans `data/imports/operations/_archive/{name}.bak_<ts>`. Résout le cas où `list_operation_files` classifie un fichier multi-mois sous un seul mois dominant (mode) masquant les autres mois du dropdown.
  - `scripts/merge_overlapping_monthly_files.py` : fusionne les fichiers d'opérations qui se chevauchent sur un même mois (ex. après split qui produit un doublon avec un fichier mensuel pré-existant). Algorithme : hash op-identité `(Date, Libellé.strip(), Débit, Crédit)`, heuristique `enrichment_score` pour choisir la version la plus riche (cat + sous-cat + justif + lock + commentaire + ventilation + ...) à hash identique, tri par Date asc, écriture dans `operations_merged_YYYYMM_<ts>.json`. Rebinde GED + OCR vers le nouveau file+index. Inclut une passe `recover_orphan_refs_to_archived` qui réhabilite les refs déjà cassées (pointant vers un ancien fichier archivé) via lookup hash dans les fichiers actifs.

- **Déduplication client-side `useYearOperations`**
  - Enrichit désormais chaque op avec `_index` (position locale dans le fichier source) en plus de `_sourceFile` — utile pour bulk-lock et snapshots en mode year-wide
  - Set `seen` sur hash `${Date}|${Libellé.trim()}|${Débit}|${Crédit}` : première occurrence gagne. Filet de sécurité contre les chevauchements de fichiers (ex. réimport accidentel, gros fichier non éclaté). Complète le merge backend côté données.

### Changed (2026-04-15) — Session 24

- **Perf — `list_operation_files` : 5× plus rapide**
  - Remplace `pd.read_json` par `json.load` natif + `Counter` pour le mois/année dominant (au lieu de `pd.to_datetime` + `mode`)
  - Cache mémoire `_LIST_FILES_CACHE: {path: (mtime, meta)}` — recalcule uniquement pour les fichiers modifiés depuis le dernier appel. Cleanup automatique des entrées pour fichiers supprimés (si absents du scan courant). Avant : 125 ms constant. Après : 25 ms (cache hit).

- **Perf — `get_batch_hints` : 30-70× plus rapide**
  - Cache mémoire `_BATCH_HINTS_CACHE: {filename: (signature, hints)}` avec `signature = (ops_mtime, frozenset((ocr_name, ocr_mtime) for ocr in pending))`. Invalide automatiquement dès qu'un fichier ops ou un justificatif en attente est modifié / ajouté / supprimé. Avant : 1 055 ms (janvier) — 2 415 ms (novembre). Après : 35-56 ms (cache hit).

- **Perf — Cache React Query renforcé**
  - `useOperationFiles` : `staleTime: 60 * 1000` → le dropdown des mois ne refetch pas à chaque navigation
  - `useOperations(filename)` : `staleTime: 30 * 1000` → revenir à un mois déjà visité est instantané
  - `useBatchHints(filename)` : `staleTime: 2 * 60 * 1000` + `placeholderData: keepPreviousData` → évite le refetch excessif ET le re-render complet du TanStack Table (les colonnes ont `batchHints` dans les deps → avec keepPreviousData on garde les anciens hints le temps du fetch)

### Fixed (2026-04-15) — Session 24

- **Snapshots — Index source au lieu de `row.index` filtré**
  - Bug critique au moment de la création du snapshot : `Object.keys(rowSelection).map(rowId => row.index)` utilisait la position visible (post-filtre/tri) au lieu de l'index dans le fichier source → refs incorrectes
  - Fix : `op._index ?? Number(rowId)` — en year-wide `_index` est enrichi par `useYearOperations`, en single-file le `rowId` TanStack (par défaut = index dans `data` array) correspond à l'index dans le fichier source. Garde défensive : `if (!file || Number.isNaN(index)) return null`

- **Preview PDF — plus d'iframes dans les listes**
  - Rappel : les `<object>`/`<iframe>` PDF dans les listes/grilles se déchargent silencieusement après ~5-10 instances (limite Chrome). Utiliser `PdfThumbnail` (cache PNG backend). Non lié à cette session mais documenté ici pour mémoire.

### Security / Data integrity (2026-04-15) — Session 24

- **Snapshots self-healing via hash**
  - Les refs `operation_ref` ne sont plus fragiles face aux opérations de migration données (split/merge/archivage de fichiers ops). `resolve_snapshot_ops` tente un lookup hash dans `data/imports/operations/_archive/` si le fichier est introuvable, puis persiste les refs réparées pour éviter le coût au prochain accès.
  - Limite connue : si le bug d'index original (Session 24 Fixed) a été exécuté sur des snapshots historiques, l'auto-repair retrouvera les ops aux index erronés (bug initial) avec leurs hashes, pas l'intention de l'utilisateur. Recommandation : supprimer + recréer les snapshots qui montrent des ops surprenantes.

---

### Added (2026-04-14) — Session 23

- **Verrouillage des opérations validées (`locked`)**
  - Nouveaux champs `locked: Optional[bool] = False` + `locked_at: Optional[str] = None` sur le modèle `Operation` (backend Pydantic + frontend TypeScript)
  - **Set automatique** dans `backend/routers/rapprochement.py:associate_manual` après succès du service → toute association manuelle verrouille l'op (set `locked_at` via `datetime.now().isoformat(timespec="seconds")`)
  - **Skip silencieux** dans `backend/services/rapprochement_service.py:run_auto_rapprochement` : `if op.get("locked"): continue` en tête de la boucle d'itération, avant les branches ventilée/non-ventilée → les ops verrouillées sont ignorées par l'auto-rapprochement quelle que soit leur structure
  - **Gardes HTTP 423** dans les 2 routers d'association/dissociation :
    - `backend/routers/rapprochement.py:associate_manual` → 423 si op lockée (sauf si `req.force=True`, champ ajouté sur `ManualAssociateRequest` pour bypass futur)
    - `backend/routers/justificatifs.py:dissociate_justificatif` → 423 systématique si op lockée (pas de bypass)
    - Message FR : « Opération verrouillée — déverrouillez avant de modifier l'association / dissocier »
  - **Nouveau endpoint** `PATCH /api/operations/{filename}/{index}/lock` avec body `{locked: bool}` → `{locked, locked_at}`. Pattern idempotent par valeur (pas un toggle aveugle) via méthode PATCH + body Pydantic explicite
  - **Hook** `useToggleLock` (`frontend/src/hooks/useToggleLock.ts`) : mutation `api.patch(/operations/${filename}/${index}/lock, {locked})` avec invalidation `['operations', filename]` + `['justificatifs']`
  - **Composant** `UnlockConfirmModal` (`frontend/src/components/UnlockConfirmModal.tsx`) : modale 380px avec backdrop, icône `Lock` warning dans cercle `bg-warning/15`, titre « Déverrouiller l'association ? », message démonstratif sur le risque auto-rapprochement, boutons Annuler + Déverrouiller (warning)
  - **Composant** `LockCell` (`frontend/src/components/LockCell.tsx`) : null si `!hasJustificatif`, click unlocked → lock immédiat + toast succès, click locked → ouvre `UnlockConfirmModal` → confirm → unlock + toast. Icônes `Lock` orange `text-warning` (`#f59e0b`) si verrouillé / `LockOpen` gris `text-text-muted/40` sinon, taille 14px
  - **Tooltip custom** au survol des cadenas (pas `title=` natif) : ancré `right-0` (pas centré — évite débordement quand la colonne Justif. est en bord droit de l'écran), card 240px avec gradient `amber-500 → orange-500` + texte blanc si locked OU `bg-surface` neutre + texte clair sinon, pastille `ShieldCheck`/`Lock` + titre en gras + description démonstrative (« Le rapprochement automatique ne peut plus toucher à ce justificatif… ») + CTA `MousePointerClick` + « Cliquer pour déverrouiller/verrouiller », flèche positionnée `right-[7px]` sous le bouton, fade-in 150ms avec délai
  - **Intégration JustificatifsPage** : cellule Justificatif wrapée dans `inline-flex items-center gap-1.5` après le bouton statut existant (paperclip/check/circle/ban), utilise `op._filename` + `op._originalIndex` enrichis par `useJustificatifsPage`
  - **Intégration EditorPage** : nouvelle colonne `id: 'locked'` de 28px insérée **après** `accessorKey: 'Justificatif'`, `enableSorting: false`, `enableColumnFilter: false`, utilise `op._sourceFile ?? selectedFile` + `op._index ?? row.index` pour supporter les 2 modes (single-file + year-wide)
  - **Agent IA préservé** : vérification exhaustive que `ml_service`, `ml_monitoring_service`, `ml.py` router et `operation_service.categorize_file()` ne touchent **jamais** à `Justificatif` ni `Lien justificatif` — seules mutations ML : `op["Catégorie"]` + `op["Sous-catégorie"]`. Les associations sont donc immunisées contre l'Agent IA
  - **Couches de protection** (double verrou) :
    - Couche 1 (native) : `run_auto_rapprochement` skippe déjà `Justificatif=true` + `vl.justificatif` → ops associées historiques protégées
    - Couche 2 (nouvelle) : skip supplémentaire sur `locked=true` → protège même après dissociation (re-association auto bloquée)

- **Pipeline — Étape 4 « Verrouillage des associations »**
  - 7ᵉ étape insérée dans le stepper entre Justificatifs (3) et Lettrage (5), avec renumérotation des étapes suivantes (Lettrage:5, Vérification:6, Clôture:7)
  - **Progression** : `op_verrouillées / op_associées × 100` calculée dans un memo `lockingStats` ajouté à `frontend/src/hooks/usePipeline.ts` juste après `categorizationStats` — **pas de nouveau endpoint backend**, réutilise `operationsQuery.data` déjà chargé pour l'étape 2
    - Dénominateur : ops avec `Lien justificatif` non vide OU ventilation avec au moins une sous-ligne justifiée (cohérent avec le filtre « Avec justif. » de JustificatifsPage)
    - Numérateur : parmi celles-ci, les ops avec `locked=true`
  - **Status** : `not_started` si pas de fichier ou 0 associées, `complete` si `taux >= 1`, `in_progress` si `locked > 0`, sinon `not_started`
  - **Metrics** : « Taux verrouillage » (% variant success/warning/danger selon ratio) + « Verrouillées » (N / total associées)
  - **CTA** : « Voir les associations » → `/justificatifs?file=X&filter=avec` (laisse l'utilisateur verrouiller via les cadenas LockCell existants)
  - **Pondération** : `STEP_WEIGHTS` passé de `[10, 20, 25, 25, 10, 10]` (6 étapes, somme 100) à `[10, 20, 20, 10, 20, 10, 10]` (7 étapes, somme 100) — Justif et Lettrage réduits de 5 pts chacun pour libérer 10 pts pour Verrouillage. Conséquence intentionnelle : un mois ne peut plus atteindre 100% global sans verrouiller ses associations
  - `PipelinePage` itère dynamiquement via `steps.map` → **aucune modif du composant** (isFirst/isLast calculés automatiquement)

- **PendingScansWidget — collapsed par défaut**
  - `frontend/src/components/pipeline/PendingScansWidget.tsx:240` — `useState(true)` → `useState(false)` pour que le widget « Scans en attente d'association » soit replié à chaque ouverture du pipeline
  - Évite le bruit visuel au premier coup d'œil (le badge compteur suffit) ; l'utilisateur déroule manuellement via le chevron si besoin

### Added (2026-04-14) — Session 22

- **Éditeur — Sous-drawer preview PDF grand format**
  - Dans `EditorPage`, le drawer de prévisualisation justificatif (600px à droite) garde l'`<object type="application/pdf">` qui remplit tout l'espace, plus un bouton overlay « Agrandir » (icône `Expand`) cliquable sur toute la zone PDF (`<button className="absolute inset-0">`) → ouvre un `PreviewSubDrawer` à gauche (700px) avec toolbar native PDF et PDF grand format
  - Toute la zone PDF du drawer principal est cliquable pour déclencher l'agrandissement (overlay transparent `absolute inset-0 z-10` + badge `Agrandir` décoratif `pointer-events-none z-20` visible en permanence, plus opaque au hover)
  - `PreviewSubDrawer` enrichi avec une prop optionnelle `onOpenNative?: (filename: string) => void` — si fournie, un bouton « Ouvrir avec Aperçu » (icône `ExternalLink`) apparaît dans le header avant le bouton X ; dans `EditorPage` le handler POST `/justificatifs/{name}/open-native`
  - Reset automatique du sub-drawer quand `previewJustifFile` devient null (pattern identique à `GedDocumentDrawer`)
  - Non-régression : les 2 autres consommateurs de `PreviewSubDrawer` (`ScanRenameDrawer`, `OcrEditDrawer`) ne passent pas `onOpenNative` → pas d'impact

- **Édition & Justificatifs — Icône cercle rouge barré (`Ban`) pour ops perso**
  - `EditorPage` : cellule colonne Justificatif court-circuite la logique paperclip/hint/reconstituer si `row.original['Catégorie'].toLowerCase() === 'perso'` → rendu d'un `<Ban size={14} className="text-red-400/80">` non cliquable avec tooltip « Opération perso — aucun justificatif requis » ; pas de bouton attribution ni `ReconstituerButton` pour ces lignes
  - `JustificatifsPage` : nouvelle branche `isPerso` prioritaire sur `isExempt` dans la cellule statut — icône `Ban` rouge au lieu du `CheckCircle2` sky qui s'appliquait aux catégories exemptées (CARMF, URSSAF, Honoraires gardent le comportement inchangé). Badge texte « exempté » sous l'icône masqué pour les perso (`isExempt && !hasJustif && !isPerso`) pour éviter la redondance
  - Tooltips différenciés : « Opération perso — aucun justificatif requis » (perso) vs « Catégorie X exemptée » (autres exempts)
  - Vérifié : 22/22 lignes perso en Janvier 2025 affichent `Ban` dans EditorPage, 36/36 dans JustificatifsPage ; autres catégories conservent `Paperclip`/`CheckCircle2`/`Circle`

- **Templates fac-similé — Champ `taux_tva` persistable + select UI**
  - Modèle `JustificatifTemplate.taux_tva: float = 10.0` (Pydantic default appliqué sur les templates existants au chargement)
  - `TemplateCreateRequest.taux_tva: Optional[float]` → PUT `/templates/{id}` persiste la valeur si fournie
  - `POST /api/templates/from-blank` : nouveau paramètre `taux_tva: float = Form(10.0)` transmis à `template_service.create_blank_template()`
  - `BlankTemplateUploadDrawer` : select après sous_categorie avec 4 options (`10 % restauration` défaut, `5,5 % alimentation`, `20 % standard`, `0 % exonéré`), state `tauxTva` reset à 10, transmis via FormData dans le hook `useCreateTemplateFromBlank`
  - `TemplateEditDrawer` : même select en mode édition, pavé lecture seule en mode affichage (`Taux TVA N %`) ; draft initialisé avec `tpl.taux_tva ?? 10` au `handleStartEdit` et dans l'`useEffect` d'auto-ouverture des blank templates
  - Types TypeScript mis à jour : `JustificatifTemplate.taux_tva?: number`, `TemplateUpdatePayload.taux_tva?: number`, `CreateTemplateFromBlankPayload.taux_tva?: number`
  - Ventilation TTC/HT/TVA automatique dans `_build_field_values()` : `ttc = abs(montant_op)`, `ht = ttc / (1 + taux_tva/100)`, `tva = ttc - ht`, plus `tva_rate` injecté — via `setdefault` pour ne pas écraser les valeurs déjà posées par des champs template explicites (`manual`/`fixed`)

- **Blank templates — Génération fac-similé avec background PDF + substitution de placeholders**
  - `generate_reconstitue()` résout désormais le PDF source via `get_blank_template_background_path(tpl.id)` pour les blank templates (au lieu de retomber sur `_generate_pdf()` ReportLab sobre qui ignorait le background)
  - `_build_field_values()` : pour les blank templates, injection automatique de `date` (depuis `operation.Date`) et `montant_ttc` (depuis débit/crédit) si aucun champ ne les déclare — permet la génération d'un fac-similé sans configurer manuellement les champs dans l'éditeur
  - Nouvelle fonction `_extract_placeholder_positions(pdf)` : scanne le text layer du background via `pdfplumber.extract_words()`, détecte les placeholders `{KEY}` et `(KEY)` via regex `[{(][A-Z][A-Z0-9_]*[})]`, retourne leurs positions en points PDF (origine haut-gauche)
  - Nouvelle fonction `_resolve_placeholder_value(key, field_values, tpl)` : mapping des clés courantes vers leurs valeurs formatées :
    - `DATE`, `DATE_FR` → date opération formatée DD/MM/YYYY
    - `MONTANT_TTC`, `TTC`, `MONTANT` → montant TTC sans symbole €
    - `MONTANT_HT`, `HT` → montant HT calculé depuis TTC / (1 + taux/100)
    - `MONTANT_TVA`, `TVA` → TVA calculée (TTC - HT)
    - `TAUX_TVA`, `TVA_RATE` → valeur numérique du taux
    - `FOURNISSEUR`, `VENDOR`, `VENDEUR` → `tpl.vendor`
    - `REF_OPERATION` → vendor abrégé + date compactée (ex. `CLIPTCHA-250108`)
  - Nouvelle fonction `_format_amount_plain()` : formate montant FR (`1 234,56`) **sans** symbole € — les templates ont généralement `€` en dur après le placeholder (`{MONTANT_HT} €`), le format plain évite la duplication (`7,77 € €`)
  - Nouvelle fonction `_generate_pdf_blank_overlay(path, background_pdf, field_values, tpl)` : rasterise le background PDF à 200 DPI + pour chaque placeholder détecté dessine un rectangle blanc à la position exacte + superpose la valeur substituée (Helvetica, taille auto entre 7-10pt selon hauteur placeholder). Fallback overlay haut-droite (date + TTC) si aucun placeholder détecté
  - Priorité dans `generate_reconstitue()` : (1) fac-similé classique si `source_justificatif` + coordonnées, (2) blank overlay si blank template avec background, (3) fallback `_generate_pdf()` ReportLab sobre
  - Testé sur template CLIPTCHAUME (note de repas Clinique du Pont de Chaume) : 7 placeholders détectés (`{DATE_FR}×2`, `{REF_OPERATION}`, `{MONTANT_HT}×2`, `{MONTANT_TVA}`, `{MONTANT_TTC}`), substitués correctement avec le layout visuel préservé (logo ELSAN, entête, tableau, footer)

### Added (2026-04-14) — Session 21

- **Fac-similé : création depuis un PDF vierge + propagation hints catégorie**
  - Nouveau flag `is_blank_template: bool = False` sur `JustificatifTemplate` (+ `page_width_pt`, `page_height_pt` pour click-to-position)
  - Nouveau service `template_service.create_blank_template(file_bytes, vendor, aliases, category, sous_categorie)` : sauvegarde le PDF dans `data/templates/{id}/background.pdf`, rasterise un thumbnail 200px via `pdf2image`, lit les dimensions de page via `pdfplumber`, crée le template avec `fields=[]` (pas d'OCR)
  - Endpoint `POST /api/templates/from-blank` (multipart/form-data : file + vendor + vendor_aliases JSON + category + sous_categorie) + validation magic bytes `%PDF`
  - Endpoint `GET /api/templates/{id}/thumbnail` (PNG cache, régénéré si PDF plus récent)
  - Endpoint `GET /api/templates/{id}/background` (FileResponse PDF)
  - Endpoint `GET /api/templates/{id}/page-size` (dimensions pt PDF pour conversion pixel → pt côté client)
  - **Propagation automatique des hints catégorie** : `generate_reconstitue()` écrit désormais `category_hint` + `sous_categorie_hint` top-level dans le `.ocr.json` généré si `template.category` est défini → le scoring rapprochement v2 bénéficie des hints dès la génération (score catégorie 1.0 au lieu de dépendre de la prédiction ML)
  - Frontend : nouveau drawer `BlankTemplateUploadDrawer` (420px, dropzone PDF + vendor + aliases chips + catégorie/sous-catégorie en cascade)
  - Hook `useCreateTemplateFromBlank()` (multi-field FormData via fetch natif)
  - Bouton « Depuis un PDF vierge » (icône `FilePlus2`) dans la barre de filtres de `TemplatesTab` + bouton dans l'état vide
  - Badge overlay `VIERGE` amber sur les cartes de template + chip catégorie · sous-catégorie
  - `TemplateEditDrawer` : auto-ouverture en mode édition pour blank templates sans champs, colonne `Position` avec bouton `Placer` / `Clic...`, click-to-position sur l'aperçu (conversion pixel → pt PDF via ratio `pageWidthPt / img.clientWidth`), overlays rectangles amber sur les champs positionnés, `canSave` relaxé pour blank templates
  - Model `TemplateCreateRequest.is_blank_template` optionnel (préservé sur PUT si fourni)
  - Helpers `get_blank_template_background_path(id)`, `get_blank_template_thumbnail_path(id)`

- **GED — axe Templates (bibliothèque des templates fac-similé)**
  - Nouvel axe `templates` dans `GedTreePanel` (icône `Wand2`, badge compteur en primary)
  - Masqué automatiquement si aucun template existe (`templatesCount === 0`)
  - Panneau gauche en mode templates : sous-composant `TemplatesFilterList` avec 2 sections (AFFICHAGE : Tous / Depuis PDF vierge / Depuis justificatif · CATÉGORIE : Toutes + catégories distinctes des templates)
  - Nouveau composant `GedTemplatesView` : grille 2/3/4/5 colonnes de `TemplateCard` — thumbnail 128px, initiales fournisseur, chips catégorie/sous-cat, badge VIERGE, méta `{fields_count} champs · {facsimiles_generated} générés`, boutons Éditer + Générer
  - Nouveau drawer `GedTemplateDetailDrawer` (600px redimensionnable 450-1100px) : 4 sections (Aperçu thumbnail · Informations éditables inline avec vendor + aliases chips + cat/sous-cat · Champs variables readonly avec positions pt · Fac-similés générés — liste des 50 derniers cliquables vers `/justificatifs?file=...&filter=tous`)
  - Footer drawer : `Supprimer` (confirm enrichi avec compteur fac-similés conservés) · `Éditer` (ouvre `TemplateEditDrawer`) · `Générer en batch` (ouvre `BatchGenerateDrawer`)
  - Backend : 2 nouveaux endpoints
    - `GET /api/templates/ged-summary` → `list[GedTemplateItem]` (id, vendor, aliases, cat/sous-cat, is_blank_template, fields_count, thumbnail_url, created_at, usage_count, facsimiles_generated)
    - `GET /api/templates/{id}/ged-detail` → `GedTemplateDetail` (GedTemplateItem + `facsimiles: list[GedTemplateFacsimile]` trié par `generated_at` desc, max 50)
  - Helpers backend : `_iter_ocr_json_files()` scanne `en_attente/` + `traites/`, `_count_facsimiles_by_template()` agrège par `template_id` les `.ocr.json` avec `source == "reconstitue"`
  - Hooks frontend : `useGedTemplatesSummary()` + `useGedTemplateDetail(id)` — queryKey `['templates', 'ged-summary']` invalidé par prefix match sur toute mutation `['templates']`
  - `GedPage` : état dédié (`templatesFilter`, `templatesCategory`, `selectedTemplateDetailId`, `editTemplateId`, `batchTemplateId`), rendu conditionnel `activeTab === 'templates'` → `GedTemplatesView` sinon documents, montage des 3 drawers templates, navigation `/justificatifs?file=...` au clic sur un fac-similé
  - URL param `?axis=templates` pour ouvrir directement la GED sur la vue templates

- **Suppression template : préservation explicite des fac-similés**
  - Comportement backend inchangé (déjà conforme) : `delete_template()` retire uniquement l'entrée JSON du template, les PDF fac-similés + leurs `.ocr.json` restent en place, les hints `category_hint`/`sous_categorie_hint` déjà propagés restent valides, les associations aux opérations restent intactes
  - Footer de confirmation enrichi dans `GedTemplateDetailDrawer` et `TemplateEditDrawer` avec message conditionnel : « Supprimer ce template ? Les N fac-similé(s) déjà généré(s) ser[a|ont] conservé(s). » (N en emerald, sous-message masqué si N = 0)
  - `TemplateEditDrawer` utilise `useGedTemplateDetail(templateId)` pour récupérer le compteur exact

- **GedDocumentDrawer — sous-drawer preview grand format**
  - Remplace l'iframe inline 45vh par une vignette cliquable (thumbnail PNG via `/api/ged/documents/{id}/thumbnail`)
  - Overlay hover avec badge `Agrandir` (gradient `from-black/40`) + icône `Expand` Lucide
  - Click / Enter / Space → ouvre `GedPreviewSubDrawer` (nouveau composant) positionné à gauche du main drawer (`right: ${mainDrawerWidth}px`)
  - Sub-drawer : PDF grand format via `<object type="application/pdf">` (toolbar native PDF), ou `<img>` pour les images JPG/PNG
  - `key={docId}` force le remount du plugin PDF pour éviter le cache Chrome du PDF précédent
  - `return null` si main drawer fermé (évite fantôme décalé à `translate-x-full`)
  - Esc en mode capture + `stopPropagation` pour ne fermer que le sub-drawer, pas le main drawer
  - Reset auto de `showPreview` au changement de `docId`
  - Pattern miroir de `components/ocr/PreviewSubDrawer.tsx` pour cohérence cross-module

- **Tooltips stylés sur la barre de navigation GED**
  - Chaque onglet du `GedTreePanel` (Période / Année-Type / Catégorie / Fournisseur / Type / Templates) expose désormais un tooltip riche au survol
  - Style : fond blanc, texte noir, bordure `border-gray-300`, shadow-lg, largeur fixe 224px (`w-56`)
  - Contenu : titre en gras + description de l'axe (ex. "Année / Type" + "Année puis type de document (relevé, justificatif, rapport…)")
  - Délai d'apparition 150ms (`group-hover:delay-150`), `pointer-events-none` pour ne pas intercepter les clics
  - Ancien `title=` HTML natif retiré pour éviter les doubles tooltips
  - Toggle vue grille/liste dans le header GED : tooltips `Vue grille` / `Vue liste` (wrapper `overflow-hidden` remplacé par `rounded-l-md`/`rounded-r-md` sur les boutons pour laisser les tooltips s'échapper)
  - Nouveau champ `description` sur le type `TABS` de `GedTreePanel`

- **GedTree : arborescence repliée par défaut**
  - `GedTree.TreeNode` : `useState(depth === 0)` → `useState(false)` — les nœuds de premier niveau (années 2026/2025/2024, catégories, fournisseurs…) ne sont plus expandés automatiquement au chargement
  - L'utilisateur ouvre ce qu'il veut voir, zéro bruit visuel au premier affichage
  - Comportement appliqué à tous les axes (Période, Année/Type, Catégorie, Fournisseur, Type)

### Added (2026-04-14) — Session 20

- **GedSearchBar — refonte complète de la recherche GED**
  - Nouveau composant `GedSearchBar` (remplace `GedFilterBar` qui a été supprimé) positionné au-dessus du split layout, pleine largeur
  - Ligne principale : input search (debounce 250ms), séparateur, label "Montant" + 2 inputs min/max 72px (commit au blur/Enter, pas debounce), bouton `FilterIcon` toggle filtres avancés (couleur bleu `#378ADD` si un filtre avancé actif)
  - Ligne filtres avancés (repliable, auto-ouverte si un filtre avancé est déjà actif) : Type, Catégorie, Sous-catégorie (cascade : reset auto au changement de catégorie), Fournisseur, Période (Année currentYear-2..currentYear, Mois 1-12), bouton Réinitialiser
  - Ligne chips actifs colorés : search (gris), montant (amber `#FAEEDA`), type (purple `#EEEDFE`), catégorie (blue `#E6F1FB`), période (green `#EAF3DE`) — chaque chip avec bouton `×` pour supprimer ce filtre uniquement
  - Compteur résultats sous le bloc : `N documents correspondent aux filtres` / `N documents dans la bibliothèque` (pluriel auto)
  - Reset naïf `onChange({})` — `GedPage.handleFiltersChange` réinjecte `sort_by`/`sort_order` (séparation des responsabilités)
  - Backend : query params `montant_min`/`montant_max` (float) ajoutés à `GET /api/ged/documents`, filtrage avec fallback `montant || montant_brut` pour cohérence avec `GedDocumentCard`
  - Types : `GedFilters.montant_min?`/`montant_max?`, `useGedDocuments` sérialise avec guard `!== undefined` (laisse passer 0)
  - Accessibility : `aria-label` sur inputs, bouton toggle avec `aria-expanded`, chips avec `aria-label` ✕

- **Badges overlay sur thumbnails GED (justificatifs)**
  - `GedDocumentCard` affiche 3 badges en position absolute sur la zone thumbnail, UNIQUEMENT pour `doc.type === 'justificatif'`
  - **Badge statut top-right** : "En attente" (amber `#FAEEDA`/`#854F0B` + `LinkIcon`) si `statut_justificatif === 'en_attente'`, "Associé" (vert `#EAF3DE`/`#3B6D11` + `CheckCircle2`) si `operation_ref` présent et pas en attente
  - **Badge montant bottom-left** : fond `bg-black/55`, text blanc, format FR (`70,00 €`), affiché si `doc.montant != null`
  - **Badge date bottom-right** : même style, format `formatDateShort()` (`07/03/25`), fallback `date_document || date_operation`
  - Étoile favori déplacée en top-left pour les justificatifs (libère top-right pour badge statut)
  - Ancien badge pill "EN ATTENTE" supprimé (redondant avec le nouveau badge overlay)
  - Helper partagé `formatDateShort(dateStr)` dans `lib/utils.ts` (convertit `"2025-03-07"` → `"07/03/25"`)
  - Classes `whitespace-nowrap` sur les badges overlay pour éviter les retours à la ligne en petite résolution

- **GedDocumentDrawer — Édition OCR + Suppression propre (justificatifs uniquement)**

  **Édition OCR depuis la GED**
  - Double point d'entrée sur les justificatifs mal nommés : badge ambre **« Mal nommé ? Éditer OCR »** dans le header + bouton **« Éditer données OCR »** dans la zone Actions
  - Ouvre `OcrEditDrawer` en overlay (z-50 naturel via DOM render order) avec l'item OCR pré-rempli
  - Résolution de l'item via `useOcrHistory(2000)` (cache TanStack partagé avec OCR > Gestion OCR) + `find(i => i.filename === basename)`
  - Fallback synthétique si pas de `.ocr.json` existant : construit `OCRHistoryItem` minimal depuis les données GED (`doc.fournisseur`, `doc.montant`, `doc.date_document`) — édition possible même sans OCR initial
  - À la fermeture : invalide caches GED (`ged-documents`, `ged-tree`, `ged-stats`, `ocr-history`) + ferme le drawer parent (le `doc_id` peut être obsolète après rename canonique)

  **Suppression propre du justificatif**
  - Bouton rouge **« Supprimer le justificatif »** + sous-texte explicatif dans le footer du drawer
  - Utilise le helper partagé `showDeleteConfirmToast` + hook `useDeleteJustificatif` (pattern identique à EditorPage/OcrPage/JustificatifsPage)
  - Nettoie : PDF + `.ocr.json` + thumbnail GED + metadata GED + liens opérations (parentes + ventilations) + cache
  - Toast succès détaillé listant les nettoyages effectués
  - Ferme automatiquement le drawer après succès
  - Ancien flow `useGedDeleteDocument` (DELETE `/api/ged/documents/{docId}`, qui ne nettoyait que la metadata GED) conservé pour `document_libre` et types custom

- **OcrEditDrawer — Nom canonique affiché en live**
  - Nouveau memo `livePreviewCanonical` (toujours calculé) vs `plannedCanonicalName` (null si identique au filename)
  - Affichage déplacé dans la zone éditeur, sous les champs Fournisseur/Date/Montant (au lieu du pied du drawer)
  - 3 états visuels :
    - **Nouveau nom** : code mono vert emerald (`bg-emerald-500/10 border-emerald-500/40`) — rename sera appliqué
    - **Déjà conforme** : code mono gris (`text-text-muted`) + badge « déjà conforme » — pas de rename nécessaire
    - **Données manquantes** : texte ambre « Fournisseur, date et montant requis pour générer le nom. »
  - Se met à jour **à chaque frappe** dans supplier/date/montant
  - Ancien bloc redondant en bas supprimé (consolidation dans le nouveau placement)

- **OcrEditDrawer — Sélecteur d'opération refondu**
  - `<select>` natif remplacé par un **dropdown custom riche**
  - **Filtre par mois du justificatif** en live : `justifMonth` dérivé de `effectiveDate` (ou `item.best_date` en fallback), chip bleu `📅 Avril 2025` cliquable pour basculer "Ce mois uniquement" ↔ "Toute l'année"
  - Trigger stylisé (ChevronDown qui pivote, `border-primary` + `ring-primary/20` quand ouvert), affiche l'op sélectionnée en vue compacte (date · libellé · montant)
  - Panel dropdown : recherche textuelle intégrée (libellé + catégorie, debounce natif input), autoFocus, compteur `N ops non associées en MOIS / Total cette année : N`
  - Items enrichis : date `DD/MM/YY` en mono petit + badge catégorie violet pill (`Véhicule · Parking`) + libellé tronqué + montant aligné droite en `tabular-nums` (vert emerald préfixé `+` si crédit), icône `Check` si sélectionné
  - Click outside / Esc ferme le dropdown sans fermer le drawer parent
  - État vide intelligent : `Aucune opération non associée en MOIS` + bouton `Voir toute l'année (N ops) →` si des ops existent hors du mois
  - Reset dropdown state (open/search) au changement d'item
  - Imports ajoutés : `ChevronDown`, `Check`, `Search as SearchIcon`, `CalendarDays`, `formatDateShort`, `MOIS_FR`

### Added (2026-04-14) — Session 19

- **Ventilation UX bout-en-bout — Éditeur, Justificatifs, Rapports**

  **Justificatifs — sous-lignes visibles**
  - Les ops ventilées affichent la ligne parente (montant total) + N sous-lignes indentées (L1, L2…) avec chacune son propre trombone cliquable
  - Filtres `sans`/`avec` adaptés : op "avec" = toutes sous-lignes associées, op "sans" = au moins une sous-ligne vide
  - Ligne parente affiche un `CheckCircle2` vert quand `allVlAssociated` (toutes les sous-lignes ont un justificatif)
  - Fichiers : `useJustificatifsPage.ts`, `JustificatifsPage.tsx`

  **Éditeur — trombones cliquables sur sous-lignes**
  - `VentilationLines.tsx` accepte `onJustifClick` (sous-ligne associée → preview PDF) et `onAttributeClick` (sous-ligne vide → drawer attribution avec sous-ligne pré-sélectionnée)
  - Bouton paperclip emerald (associé) ou amber (à associer) avec `stopPropagation()` pour ne pas ouvrir le VentilationDrawer
  - `RapprochementWorkflowDrawer` accepte nouveau prop `initialVentilationIndex` → pré-sélection d'une pill
  - `useRapprochementWorkflow` : state `selectedVentilationIndex` initialisé depuis `initialVentilationIndex` + reset effect mis à jour
  - EditorPage : state `drawerInitialVentIdx` + handler onAttributeClick

  **Rapports — explosion ventilation**
  - `_explode_ventilations()` dans `report_service.py` : chaque op ventilée éclatée en N sous-lignes avec libellé `[V{i+1}/{N}]`, catégorie/montant/justificatif de la sous-ligne
  - Appelé avant `_apply_filters()` pour que les sous-catégories soient filtrables
  - Fix : les rapports PDF/CSV ne montrent plus de catégorie "Ventilé" agrégée — les totaux sont correctement répartis par sous-catégorie
  - Excel non modifié (format peu utilisé)

- **Suppression complète justificatif — bouton sur 3 pages + toast design**
  - `delete_justificatif()` retourne désormais un `dict` détaillé (`ops_unlinked`, `thumbnail_deleted`, `ged_cleaned`, `ocr_cache_deleted`) au lieu de `bool`
  - `_clean_operation_link()` descend dans les ventilations + retourne la liste des ops délinkées
  - Helper partagé `lib/deleteJustificatifToast.ts` : `showDeleteConfirmToast()` (confirmation avec libellé op, boutons Supprimer/Annuler 8s) + `showDeleteSuccessToast()` (succès détaillé listant les nettoyages)
  - Bouton Supprimer (Trash2 rouge) présent sur : OCR Gestion OCR (hover), EditorPage preview footer, JustificatifsPage preview footer
  - Hook `useDeleteJustificatif` typé `useMutation<DeleteJustificatifResult, Error, string>`
  - Nettoyage complet : PDF + `.ocr.json` + thumbnail + GED metadata + liens ops (parentes + ventilations) + cache

- **Auto-rapprochement après ventilation**
  - `PUT /api/ventilation/{file}/{idx}` lance `run_auto_rapprochement()` en arrière-plan (`BackgroundTasks`)
  - Chaque sous-ligne est scorée contre les justificatifs en attente (scoring v2, seuil 0.80)
  - Plus besoin de cliquer "Associer automatiquement" après une ventilation

### Fixed (2026-04-13) — Session 18

- **Filtre justificatifs deja referencies — 3 phases**

  **Phase 1 — Base correcte `_collect_referenced_justificatifs()`**
  - `_collect_referenced_justificatifs()` descend desormais dans les sous-lignes de ventilation (`op.ventilation[].justificatif`)
  - Nouvelle fonction publique `get_all_referenced_justificatifs()` → `set[str]` avec cache TTL 5s
  - `invalidate_referenced_cache()` appele dans `associate()`, `dissociate()`, `rename_justificatif()`, `apply_link_repair()`

  **Phase 2 — Propagation du filtre sur 6 endpoints**
  - `get_filtered_suggestions()` : exclut les justificatifs deja associes (exception : op courante pour re-association)
  - `list_justificatifs(status=en_attente)` : exclut les fichiers deja referencies
  - `suggest_operations()` (sens inverse OCR) : exclut les ops liees a un autre justificatif
  - `get_batch_justificatif_scores()` : skip avant calcul de score
  - `get_batch_hints()` : exclut des pending_ocr
  - `get_unmatched_summary()` : compteur `justificatifs_en_attente` = libres uniquement

  **Phase 3 — Cycle de vie hints OCR**
  - `dissociate()` efface `category_hint` / `sous_categorie_hint` du `.ocr.json` → `score_categorie()` retourne `None` (neutre) au lieu de penaliser avec un hint perime
  - `ocr_service.update_extracted_data()` supporte `None`/`""` = suppression de cle (`data.pop()`)
  - Verifie : `generate_reconstitue()` appelle deja `justificatif_service.associate()` (aucun fix necessaire)

  **Fichiers modifies** : `justificatif_service.py`, `rapprochement_service.py`, `ocr_service.py`, `CLAUDE.md`, `docs/architecture.md`, `docs/api-reference.md`

### Added (2026-04-12) — Session 17

- **Repas pro — sous-catégories + participants**
  - Catégorie `repas` renommée en `Repas pro` avec 2 sous-catégories : `Repas seul` et `Repas confrères`
  - Migration lifespan idempotente : toutes les opérations `repas` → `Repas pro` / `Repas seul` au démarrage backend
  - `Repas seul` exempt de justificatif obligatoire (ajout dans `settings.json` > `justificatif_exemptions.sous_categories`)
  - Champ `participants` (Optional[str]) ajouté au modèle Operation (backend + frontend)
  - Composant `ParticipantsCell` : icône Users2 (violet si rempli), badge compteur, popover textarea avec Ctrl+Enter pour sauver
  - Colonne participants dans EditorPage, visible uniquement pour `Sous-catégorie = "Repas confrères"`
  - Règle ML UBER EATS → `perso` / `Repas` (84 opérations existantes recatégorisées)
  - Sous-catégorie `Repas` créée sous `perso` pour les livraisons alimentaires
  - `data/ml/model.json` : exact_matches `ubereats`/`uber eats`/`ubereatshelp` → `perso`, subcategories → `Repas`
  - `data/ml/training_examples.json` : toutes les entrées `repas` → `Repas pro`

- **Charges forfaitaires — Onglet Repas (forfait déductible BOI-BNC-BASE-40-60)**
  - Nouvel onglet Repas dans `/charges-forfaitaires` avec badge pill orange (icône UtensilsCrossed)
  - Barème URSSAF versionné `data/baremes/repas_{year}.json` : seuil repas maison (5,35 €) + plafond restaurant (20,20 €)
  - Forfait déductible/jour = plafond − seuil = 14,85 € (toujours calculé, jamais stocké)
  - Calcul live **côté client** (`useMemo`) — instantané à chaque frappe
  - InfoBox référence légale BOI-BNC-BASE-40-60
  - 3 MetricCards : seuil maison (URSSAF), plafond restaurant (URSSAF), forfait/jour (calculé, bordure violet)
  - Tableau barème 3 colonnes (Paramètre / Valeur / Source) avec total déductible en pied
  - Jours travaillés **partagés** avec Blanchissage (même config key, mention "partagé avec Blanchissage")
  - Même workflow que Blanchissage : OD décembre, PDF ReportLab A4, enregistrement GED, toast brandé
  - État 2 généré : checklist 3✓, thumbnail PDF, boutons GED/Regénérer/Envoyer au comptable
  - OD : catégorie `Repas pro` / `Repas seul`, marker `"Charge forfaitaire repas {year}"`
  - PDF nommé `repas_{year}1231_{montant}.pdf` dans `data/reports/`
  - 3 endpoints API : `POST /calculer/repas`, `GET /bareme/repas`, `DELETE /supprimer/repas`
  - 2 modèles Pydantic : `RepasRequest`, `RepasResult`
  - `TypeForfait.REPAS` ajouté à l'enum
  - 3 hooks React : `useBaremeRepas`, `useCalculerRepas`, `useSupprimerRepas`
  - Composant : `RepasTab.tsx`
  - Endpoint `/generes` enrichi pour inclure les forfaits repas

### Added (2026-04-12) — Session 15

- **Charges forfaitaires — Onglet Véhicule (quote-part professionnelle)**
  - Nouvel onglet Véhicule dans la page `/charges-forfaitaires` avec tabs badges pill colorés (Shirt violet / Car bleu)
  - Calcul du ratio kilométrique pro : `(jours × distance_aller × 2 + km_sup) / km_totaux × 100`
  - Calcul live **côté client** (`useMemo`) — instantané à chaque frappe (pas d'appel API)
  - 4 inputs : distance domicile→clinique (km aller), jours travaillés (step 0.5, partagé avec blanchissage), km supplémentaires (gardes/formations), km totaux compteur (relevé annuel)
  - Champ honoraires liasse fiscale SCP (optionnel, même pattern que blanchissage)
  - 3 MetricCards (km trajet habituel, km professionnels, % déductible)
  - Barre visuelle pro/perso avec labels %
  - Encadré poste comptable actuel avec delta pts (warning/success)
  - **Tableau dépenses véhicule** : sous-catégories agrégées depuis les ops Véhicule+Transport, montant brut × ratio = montant déductible. Visible dans les 2 états (saisie + appliqué)
  - Application : mise à jour `deductible_pct` du poste GED "véhicule" dans `ged_postes.json` + PDF rapport ReportLab A4 (paramètres, résultat, ancien→nouveau taux, tableau dépenses, honoraires liasse si renseigné) + enregistrement GED + historique barème
  - **Auto-regénération PDF** silencieuse à chaque visite de l'onglet (met à jour le tableau dépenses avec les dernières opérations catégorisées)
  - Toast custom brandé (logo + gradient violet) à l'application
  - Aperçu PDF via `PdfThumbnail` (PNG server-side) + `PdfPreviewDrawer` (drawer 700px avec boutons ouvrir/télécharger/fermer)
  - Simulation BNC : ligne informative véhicule (ratio %, pas checkbox) + lien "Configurer →" si non appliqué
  - Barème historique `data/baremes/vehicule_{year}.json` avec traçabilité des applications
  - Config partagée dans `charges_forfaitaires_config.json` (jours_travailles partagé, champs vehicule_*)
  - 6 nouveaux endpoints API : `POST /calculer/vehicule`, `POST /appliquer/vehicule`, `POST /regenerer-pdf/vehicule`, `GET /vehicule/genere`, `DELETE /supprimer/vehicule`
  - 4 modèles Pydantic : `VehiculeRequest`, `VehiculeResult`, `ApplyVehiculeRequest`, `ApplyVehiculeResponse`
  - 4 hooks React : `useCalculerVehicule`, `useAppliquerVehicule`, `useVehiculeGenere`, `useSupprimerVehicule`, `useRegenerPdfVehicule`
  - Composants : `VehiculeTab.tsx`, `PdfPreviewDrawer.tsx` (partagé blanchissage/véhicule)

- **Charges forfaitaires — Améliorations blanchissage**
  - Thumbnail PDF migré de `<object>/<iframe>` vers `PdfThumbnail` (PNG) — résout le bug des clics capturés par le plugin PDF
  - Aperçu PDF en drawer latéral (`PdfPreviewDrawer` 700px) au lieu de l'expand inline
  - Fallback `pdf_filename` dans `get_forfaits_generes()` quand `Lien justificatif` est vide (nettoyé par repair links au boot)

### Added (2026-04-12)

- **Compte d'attente — filtres catégorie + sous-catégorie**
  - 2 dropdowns de filtre ajoutés dans `AlertesPage` entre les boutons mois et le tableau
  - Dropdown **Catégorie** : liste complète du référentiel (via `useCategories()`), pas seulement les catégories présentes dans les opérations en attente
  - Dropdown **Sous-catégorie** : activé quand une catégorie est sélectionnée, affiche la liste complète des sous-catégories du référentiel pour cette catégorie
  - Reset automatique de la sous-catégorie au changement de catégorie
  - Bouton **Réinitialiser** (X) pour remettre les 2 filtres à zéro
  - Compteur d'opérations filtrées affiché à droite (ex. « 12 opérations »)
  - Filtrage côté client uniquement (pas de changement backend)

- **Sandbox toast persistant**
  - `SandboxArrivalToast` passe de `duration: 6000` à `duration: Infinity`
  - Le toast d'arrivée d'un nouveau scan OCR reste affiché jusqu'à action utilisateur (clic carte ou bouton X)

### Added / Changed (2026-04-12) — Session 13

- **Tâches Kanban — réordonnancement drag & drop vertical**
  - Nouveau champ `order: int` sur le modèle `Task` (backend + frontend) pour persister l'ordre des tâches au sein d'une colonne
  - Nouveau endpoint `POST /api/tasks/reorder` accepte `{ ordered_ids: string[] }` et met à jour les `order` correspondants
  - `handleDragEnd` réécrit : supporte le réordonnancement **intra-colonne** via `arrayMove` (@dnd-kit/sortable) en plus du déplacement inter-colonnes existant
  - Collision detection `closestCorners` au lieu du défaut @dnd-kit (meilleure détection des cibles dans les SortableContext imbriqués)
  - Tri des colonnes par `order` au lieu de priorité+date (suppression du `PRIORITY_ORDER` sort dans `KanbanColumn`)
  - Auto-assignation de `order=max+1` à la création d'une tâche et au changement de colonne (PATCH status)
  - Hook `useReorderTasks()` dans `useTasks.ts`

- **Toast sandbox — affichage du nom de fichier original**
  - `SandboxArrivalToast` affiche `originalFilename` (nom du fichier déposé) en titre principal
  - Si auto-renommé, une ligne secondaire `→ filename` montre le nom canonique après renommage
  - Corrige le feedback utilisateur : on voit désormais le nom qu'on a déposé, pas le nom cryptique post-OCR

#### Fichiers modifiés
- `backend/models/task.py` — champ `order: int = 0`
- `backend/routers/tasks.py` — endpoint `/reorder`, auto-order dans `create_task` et `update_task`
- `frontend/src/types/index.ts` — `order: number` sur `Task`
- `frontend/src/hooks/useTasks.ts` — `useReorderTasks()`
- `frontend/src/components/tasks/TasksPage.tsx` — `closestCorners`, `handleDragEnd` intra-colonne
- `frontend/src/components/tasks/KanbanColumn.tsx` — suppression tri priorité, tasks pré-triées
- `frontend/src/components/shared/SandboxArrivalToast.tsx` — affichage originalFilename

### Fixed (2026-04-11) — Patch fix-thumbnail-preview

- **Hover popover OCR Gestion OCR : migration `<iframe>` PDF → `<img>` thumbnail PNG**
  - Symptôme : le popover 300×400 au hover du bouton « Aperçu » dans la colonne Fichier affichait un `<iframe src=".../preview">` qui se déchargeait silencieusement lorsque le plugin PDF du navigateur n'arrivait pas à conserver 30+ instances en parallèle — forçait un hard refresh
  - Fix : `OcrPage.tsx:711` — remplacement de `<iframe>` par `<PdfThumbnail justificatifFilename={filename}>` qui pointe vers l'endpoint PNG `/api/justificatifs/{filename}/thumbnail` (cache `data/ged/thumbnails/{md5}.png`, 200×N)
  - `lazy={false}` car le popover n'existe qu'au hover → chargement immédiat voulu
  - Classes Tailwind passées via `className` pour conserver le sizing 300×400 + `object-contain` (au lieu du `object-cover` par défaut du composant)
  - Vérifié en preview : hover sur un item affiche le thumbnail Orange 200×283 sans aucun déchargement, 0 erreur console

- **Nouveau composant partagé `PdfThumbnail`** — `frontend/src/components/shared/PdfThumbnail.tsx`
  - Props : `docId?` (→ endpoint GED) OU `justificatifFilename?` (→ endpoint justificatifs avec résolution auto `en_attente`/`traites`), `cacheBuster?`, `lazy?` (défaut `true`), `className?`, `iconSize?`, `onClick?`
  - IntersectionObserver lazy-load avec `rootMargin: 200px` (détecte les scrolls internes, contrairement au `loading="lazy"` natif qui ne couvre que le viewport racine)
  - Fallback visuel : icône `FileText` Lucide centrée au même endroit (placeholder pendant load + état erreur)
  - Pensé pour éliminer la duplication existante de logique `Thumbnail` (aujourd'hui présente dans `RapprochementWorkflowDrawer`, `ScanRenameDrawer`, `GedDocumentCard` avec des variantes) — migration progressive à suivre
  - Backend : aucun changement, les endpoints `GET /api/justificatifs/{filename}/thumbnail` + `GET /api/ged/documents/{doc_id}/thumbnail` existaient déjà (cf. session 8)

### Added / Changed (2026-04-11) — Session 12

- **OCR — refonte de l'onglet « Historique » en « Gestion OCR »**
  - Label de l'onglet renommé dans `OcrPage.tsx` (la key URL reste `'historique'` pour rétro-compatibilité des liens externes)
  - Nouveau tri `scan_date` (alias de `processed_at`) qui **ignore les filtres** courants (année/mois/supplier/search) et itère `enriched` (toutes années) pour garantir la visibilité d'un fichier cible post-toast
  - Bouton toggle « Date de scan » avec highlight violet quand actif
  - Helper `periodOf(item)` qui aligne le tri mensuel sur `best_date` (fallback filename regex) pour cohérence avec le `PendingScansWidget` du Pipeline (fix du mismatch Pipeline janvier=4 vs OCR=0)
  - URL params `?tab=historique&sort=scan_date&highlight={filename}` acceptés, `HistoriqueTab` accepte `initialSort?` + `initialHighlight?`
  - **Flash highlight** : `@keyframes ping-slow` (2s) + classes `.animate-enter`/`.animate-leave`/`.animate-ping-slow` dans `index.css`, scroll-into-view via `useEffect` + `useRef` anti-re-scroll, clean de l'URL param après animation
  - Bouton crayon par ligne → ouvre `OcrEditDrawer` (voir ci-dessous) pour édition standalone du fichier OCR

- **`OcrEditDrawer` (nouveau, 720px)**
  - Drawer standalone d'édition d'un item de la Gestion OCR déclenché par le bouton crayon par ligne
  - Même UX que `SkippedItemEditor` du `ScanRenameDrawer` mais pour les fichiers déjà renommés / associés ou en attente
  - Preview PDF iframe 220×300 cliquable → ouvre `PreviewSubDrawer` grand format
  - Éditeur supplier/date/montant avec **pills de candidats OCR** (cliquables pour sélectionner) + inputs manuels en fallback
  - Dropdowns catégorie + sous-catégorie (persistés comme `category_hint` / `sous_categorie_hint` dans le `.ocr.json`, voir section hints ci-dessous)
  - Dropdown op selector (50 candidats filtrés par cat active)
  - Flags de validation : `hasOcrChanges` + `hasHintChanges` + `canValidate = hasOcrChanges || hasHintChanges || !!selectedOpKey`
  - `handleValidate` chaîne : PATCH OCR → rename si canonique → associate si op sélectionnée → close
  - Fix du bug « bouton Enregistrer grisé » quand seules les cat/sous-cat sont modifiées (ajout `hasHintChanges` au check `canValidate`)

- **`PreviewSubDrawer` (nouveau, shared)**
  - Composant partagé `frontend/src/components/ocr/PreviewSubDrawer.tsx` utilisé par `ScanRenameDrawer` ET `OcrEditDrawer`
  - Sous-drawer positionné en `right-[mainDrawerWidth]px` avec width configurable (~600px, responsive `max-w-[calc(95vw-mainDrawerWidth)]`)
  - Props : `filename`, `mainDrawerOpen`, `mainDrawerWidth`, `onClose`
  - **Critique** : `if (!mainDrawerOpen) return null` — sinon l'élément en `translate-x-full` anchoré à `right-[680px]` reste partiellement visible quand le main drawer est fermé
  - `<object type="application/pdf">` plein écran avec `key={filename}` pour forcer le remount (évite le cache Chrome du précédent PDF)
  - Header compact avec nom fichier + bouton X (close)
  - Esc handler en mode capture (`stopPropagation`) pour ne fermer que le sub-drawer sans remonter au main drawer

- **`ScanRenameDrawer` — `SkippedItemEditor` inline + chainage auto-rapprochement**
  - Les 3 buckets skipped (no_ocr / bad_supplier / no_date_amount) sont désormais expandables par fichier
  - Chaque card skipped contient un `SkippedItemEditor` inline : mini thumbnail 60×84 cliquable → `PreviewSubDrawer`, éditeur supplier/date/montant avec pills de candidats OCR + inputs manuels, dropdown op selector filtré par cat, bouton « Rename & Associate » qui chaîne PATCH OCR → rename → associate
  - Backend `rename_service.py` enrichit les buckets skipped via `SkippedItem` TypedDict (filename, supplier, best_date, best_amount, amounts, dates, reason) dans `scan_and_plan_renames()`
  - **Chainage auto-rapprochement post-apply** : après le batch de renames dans `POST /api/justificatifs/scan-rename?apply=true`, le router appelle `rapprochement_service.run_auto_rapprochement()` automatiquement
  - Résumé retourné inclut `auto_associated` (nb d'associations confirmées > seuil 0.80) + `strong_suggestions` (nb de suggestions fortes 0.65-0.80 prêtes pour review manuel)
  - Hook `useApplyScanRename` affiche les 2 nombres dans le toast de succès
  - Crée un flux one-click « Scanner & Renommer → auto-associer ce qui matche » depuis l'OCR > Gestion OCR

- **Hints comptables dans `.ocr.json` (cascade auto-hint)**
  - 2 nouvelles clés top-level `category_hint` + `sous_categorie_hint` stockées dans chaque `.ocr.json` (hors `extracted_data` pour ne pas polluer les arrays OCR)
  - **Écrites automatiquement** par `justificatif_service.associate()` à chaque association manuelle ou auto : copie `op.Catégorie` / `op.Sous-catégorie`, skip `""` / `Autres` / `Ventilé`
  - Implémenté via `ocr_service.update_extracted_data(filename, {"category_hint": cat, "sous_categorie_hint": subcat})`
  - **Lues par `rapprochement_service.score_categorie()` en override prioritaire** de la prédiction ML : un hint présent donne un score catégorie fiable (1.0 si match op, 0.6 sous-cat ≠, 0.0 sinon) au lieu de dépendre de la prédiction ML depuis le supplier parsé
  - `_load_ocr_data()` injecte les hints dans le dict `ocr_data` passé à `compute_score()` via `justificatif_ocr.category_hint` / `justificatif_ocr.sous_categorie_hint`
  - `score_categorie()` signature étendue avec `category_hint` + `sous_categorie_hint` params, `compute_score()` extrait `j_cat_hint` / `j_subcat_hint` de `justificatif_ocr` et les forwards
  - **Effet en cascade** : chaque association enrichit le `.ocr.json` → prochains rapprochements automatiques plus précis sur ce fichier (même après dissociation et ré-association éventuelle)
  - Éditables aussi via `OcrEditDrawer` / `SkippedItemEditor` (dropdowns cat/sous-cat)
  - Modèle `OcrManualEdit` étendu avec `category_hint: Optional[str] = None` et `sous_categorie_hint: Optional[str] = None`
  - `PATCH /api/ocr/{filename}/extracted-data` accepte ces 2 champs
  - `ocr_service.update_extracted_data()` stocke au **top-level** du `.ocr.json` (pas dans `extracted_data`)
  - `get_extraction_history()` retourne les hints dans chaque item
  - Router `get_history` : limit passée de 100 à 2000 pour couvrir toute l'année OCR
  - **Test e2e** : amazon_20250109 score passe de 0.547 à 0.748 (+20 points) avec hint matching

- **`PendingScansWidget` + sidebar badge sur `/ocr`**
  - Nouvelle carte « Scans en attente d'association » affichée dans `PipelinePage`
  - Réutilise le design `PipelineStepCard` : cercle icône Paperclip, mini progress bar, chevron expand
  - **Filtré par `year + month`** du sélecteur pipeline (cohérence parfaite avec les autres étapes)
  - 2 sections dans l'expand : OCR récents + Fac-similés (séparés via `isReconstitue()`)
  - 1-click associate avec `confirm()` pour les scores faibles
  - Bouton « Traiter » navigue vers `/justificatifs?filter=sans&year=Y&month=M`
  - Badge compteur orange dans la sidebar sur l'item `/ocr` (via `useJustificatifStats.pendingScansCount`)
  - `useSandbox()` hook lifté au niveau de `AppLayout` pour écouter le SSE globalement, quelle que soit la page active (évite de perdre les événements d'arrivée sur les pages non-OCR)

- **`SandboxArrivalToast` — toast riche global sur arrivée sandbox**
  - Nouveau composant `components/shared/SandboxArrivalToast.tsx` (~130 lignes)
  - Gradient border violet→indigo, pulse ring animation, design moderne
  - Affiche supplier/date/amount extraits de l'OCR, badge AUTO si auto-renommé, CTA « Voir dans l'historique »
  - Click → navigation vers `/ocr?tab=historique&sort=scan_date&highlight={filename}`
  - Déclenché par `showArrivalToast(data)` (fonction module-level de `useSandbox.ts`) sur événement SSE `processed`
  - Implémenté via `toast.custom()` + `createElement` + `window.history.pushState` + `PopStateEvent` — **pas de `useNavigate`** pour éviter un bug d'ordre de hooks dans `AppLayout` (le hook `useSandbox()` est lifté au niveau global)
  - Backend `sandbox_service._push_event()` étendu avec params `supplier`, `best_date`, `best_amount` ; `_process_file()` lit le cache OCR après processing et transmet au push event
  - `SandboxEvent` type côté frontend étendu avec ces 3 champs

- **Thumbnails GED — fix des 236 orphelins + invalidation chaînée**
  - Bug historique : 236 thumbnails orphelins dans `data/ged/thumbnails/` dû à des moves/renames sans invalidation du cache (ex. `clinique-pont-de-chaumes_20250324_126,24.pdf == Fichier non trouvé`)
  - Nouveau helper `ged_service.delete_thumbnail_for_doc_id(doc_id)` (public)
  - Nouveau helper `justificatif_service._invalidate_thumbnail_for_path(abs_path)` qui calcule le `doc_id` (relatif à `BASE_DIR`), appelle `ged_service.delete_thumbnail_for_doc_id(doc_id)` et supprime le PNG cache
  - **Appelé avant tout move/rename/delete** : `associate()` (avant move en_attente→traites), `dissociate()` (avant move traites→en_attente), `rename_justificatif()`, `delete_justificatif()`
  - Nouveau helper `_update_ged_metadata_location(filename, new_location)` qui met à jour `ged_metadata.json` (clé dict + champ `doc_id` + champ `ocr_file`) pour chaque justificatif déplacé
  - Cleanup script one-shot exécuté pour purger les 236 orphelins existants
  - La GED régénère les thumbnails à la demande au prochain accès

- **Nouvel endpoint thumbnail cross-location**
  - `GET /api/justificatifs/{filename}/thumbnail` — résout automatiquement `en_attente/` puis `traites/` (via `get_justificatif_path()`) puis délègue à `ged_service.get_thumbnail_path()`
  - Évite le bug des blank thumbnails quand un composant frontend hard-codait `en_attente/` mais que le fichier était déjà dans `traites/` (cas ford-revision)
  - Utilisé par `Thumbnail`, `SuggestionCard`, `SkippedItemEditor`, `OcrEditDrawer`, `PreviewSubDrawer`

- **Fix `.pdf.pdf` (Path.with_suffix)**
  - Bug : `old_filename.replace(".pdf", ".ocr.json")` remplaçait **toutes** les occurrences de `.pdf`, corrompant les noms `xxx.pdf.pdf` en `xxx.ocr.json.pdf`
  - Remplacé par `Path(old_filename).with_suffix(".ocr.json").name` dans 4 endroits :
    - `justificatif_service.rename_justificatif()` (ligne 695)
    - `ocr_service._find_ocr_cache_file()`
    - `ocr_service.move_ocr_cache()`
    - Et 1 autre occurrence annexe

- **Browser tab title sync**
  - `AppLayout.tsx` contient désormais un `ROUTE_TITLES: Record<string, string>` mappant chaque route vers son label sidebar
  - `useEffect` qui met à jour `document.title` à chaque changement de `location.pathname`
  - Utile pour reconnaître les onglets quand plusieurs pages sont ouvertes en parallèle (Pipeline / Justificatifs / Gestion OCR / …)

- **JustificatifsPage — filtre catégorie/sous-cat persistant au changement de mois**
  - `useJustificatifsPage` expose désormais `categoryFilter` + `subcategoryFilter` (états React)
  - **Conservés au travers des changements de mois** (contrairement à l'ancienne version qui reset au changement)
  - Memo `operations` applique les 2 filtres avec support `__uncategorized__` (matche vide + "Autres")
  - Panel filtres dans la UI à côté du filtre sans/avec/tous
  - Même UX que les filtres catégorie/sous-cat de `EditorPage` (cascade subcat dépend de cat)

- **Lien bidirectionnel GED → Éditeur via `JustificatifOperationLink`**
  - Nouvelle prop `showEditorLink?: boolean` sur `JustificatifOperationLink`
  - Quand activée, ajoute un second bouton « Ouvrir dans l'Éditeur » qui navigue vers `/editor?file=X&highlight=Y`
  - Utilisé dans le drawer GED pour offrir les 2 points d'entrée (Éditeur + Justificatifs)
  - `EditorPage` supporte déjà les URL params `?file=X&highlight=Y` avec surbrillance permanente

- **Onglet `/ocr` — Gestion OCR (documentation)**
  - L'onglet « Historique » du flux OCR est officiellement renommé « Gestion OCR » dans la sidebar et le tableau des routes
  - Décrit désormais comme « centre de gestion des fichiers OCR » avec : tri scan_date/date/supplier/confidence, filtre association, recherche multifocale, bouton crayon par ligne → OcrEditDrawer, bouton orange Scanner & Renommer → ScanRenameDrawer
  - Key URL inchangée (`'historique'`) pour rétro-compatibilité

### Added / Changed (2026-04-11) — Session 11

- **Intégrité des liens justificatifs (scan + répare auto)**
  - Nouveau service `backend/services/justificatif_service.scan_link_issues()` + `apply_link_repair()` qui détecte 6 classes d'incohérences disque ↔ opérations et les répare
  - Catégories : (A1) duplicatas `en_attente/` avec hash identique à la copie `traites/` référencée → suppression de la copie fantôme ; (A2) fichiers référencés mais physiquement en `en_attente/` → move vers `traites/` ; (B1) orphelins `traites/` duplicatas identiques en `en_attente/` → suppression copie orpheline ; (B2) orphelins `traites/` uniques → move vers `en_attente/` pour réattribution ; (C) liens fantômes (op → fichier absent) → clear `Justificatif`+`Lien justificatif` ; (SKIP) `hash_conflicts` (versions divergentes) → log warning, jamais modifiés
  - Helpers internes `_md5_file()` (stream par blocs 64 Ko), `_collect_referenced_justificatifs()`, `_move_pdf_with_ocr()`, `_delete_pdf_with_ocr()`
  - Endpoints : `GET /api/justificatifs/scan-links` (dry-run typé) + `POST /api/justificatifs/repair-links` (apply)
  - **Exécution automatique au démarrage du backend** via `lifespan()` dans `main.py` — silencieux avec logs `info` si actions appliquées, `warning` si conflits restants (pointant vers l'endpoint)
  - Script CLI `scripts/repair_justificatif_links.py` refactoré en thin wrapper autour du service (supporte `--dry-run`)
  - Frontend : section « Intégrité des justificatifs » dans `SettingsPage > Stockage` (`JustificatifsIntegritySection`), grille 6 métriques colorées (`IntegrityMetric`), bouton Scanner + bouton Réparer (avec compteur `totalFixable`), conflits listés en `<details>` collapsible
  - Hooks `useScanLinks` (`enabled: false` + refetch manuel), `useRepairLinks` (invalidation caches justificatifs/ged/ocr-history/operations)
  - Types `ScanLinksResult` + `RepairLinksResult` ajoutés dans `hooks/useJustificatifs.ts`
  - Premier scan en prod : 21 fichiers touchés + 2 conflits signalés (`auchan_20241229_34.78_fs.pdf`, `contabo_20250327_11.40.pdf`) skippés pour inspection manuelle

- **Redémarrage backend depuis l'UI (dev only)**
  - Endpoint `POST /api/settings/restart` qui touche un sentinel Python (`backend/_reload_trigger.py`) en y écrivant un timestamp ; uvicorn `--reload` détecte la modification et redémarre automatiquement
  - Hook `useRestartBackend()` dans `useApi.ts` : POST restart → sleep 1.5s → poll `GET /api/settings` (500ms, timeout 20s) → `window.location.reload()` hard
  - Bouton « Redémarrer backend » (icône `Power`, tint warning amber) dans le header de `JustificatifsIntegritySection`, à côté du bouton Scanner, avec `window.confirm()` avant exécution
  - Usage principal : rejouer la réparation des liens justificatifs au boot (lifespan) après modification manuelle

- **Garde défensive `generate_reconstitue()`**
  - Dans `template_service.generate_reconstitue()`, nouvelle garde après `_build_field_values()` qui vérifie que `field_values.get("date")` est non vide ET que `field_values.get("montant_ttc") > 0`
  - Si manquant, lève `ValueError` explicite mentionnant le template ID et les valeurs → empêche la création silencieuse de fac-similés vides (PDFs ~1736 octets) quand un template a `fields: []`
  - Cause du bug historique : 2 fac-similés Ibis Hotel vides liés à 4 opérations d'hébergement remplaçant (DU220525 76,42 / DU270525 33,00 / DU190625 63,12 / DU230625 23,00)
  - Script one-shot `scripts/fix_ibis_reconstitue.py` créé pour réparer : fix template (ajoute 3 champs `date`/`montant_ttc`/`fournisseur`) + dissociation des 4 ops + suppression des 2 PDFs vides + regénération propre en mode ReportLab sobre avec noms canoniques `ibis-hotel_YYYYMMDD_XX.XX_fs.pdf`

### Added / Changed (2026-04-10) — Session 10

- **Refactor RapprochementWorkflowDrawer (unification drawers)**
  - Fusion de `RapprochementManuelDrawer` (EditorPage) + `JustificatifAttributionDrawer` (JustificatifsPage) en un unique `RapprochementWorkflowDrawer` 700px
  - 2 modes : « Toutes sans justificatif » (flux itératif avec auto-skip post-attribution) / « Opération ciblée » (mono-op)
  - Header navigator ‹ › + compteur « N/Total · X restants », barre progression 3px, tabs mode, contexte op (date/libellé/montant/catégorie), sélecteur ventilation pills
  - Section suggestions avec recherche libre exclusive (masque les suggestions quand active), PDF preview pleine hauteur via `<object>`, barre actions (Attribuer `⏎` / Reconstituer / Passer `→`)
  - Thumbnails PDF à gauche des suggestions via endpoint GED `/api/ged/documents/{doc_id:path}/thumbnail`, **lazy-loaded via `IntersectionObserver`** (rootMargin 200px) — évite les 30+ fetches simultanés à l'ouverture
  - **Lazy-mount du subtree** : contenu interne rendu uniquement après le 1er open (`hasBeenOpened` flag) pour éviter les fetches eager au mount de la page
  - Raccourcis clavier ⏎/←/→/Esc (ignorés dans les inputs)
  - `useRapprochementWorkflow` hook central avec gestion state (mode, currentIndex, ventilation, search, selectedSuggestion, doneCount, progressPct, prefetch N+1 des suggestions via `queryClient.prefetchQuery`)
  - Drawers supprimés : `RapprochementManuelDrawer.tsx`, `JustificatifAttributionDrawer.tsx`, `RapprochementPage.tsx` (orphelin), `useRapprochementManuel.ts`
  - Nouveau hook `useJustificatifsPage.drawerInitialIndex` pour distinguer mode ciblé vs mode flux

- **Scoring v2 (moteur 4 critères + pondération dynamique)**
  - Backend `rapprochement_service.compute_score()` réécrit autour de 4 sous-scores orthogonaux
  - `score_montant()` : paliers graduels 0/1%/2%/5% → 1.0/0.95/0.85/0.60/0.0, + test HT/TTC (plancher 0.95 si `ocr / TVA ≈ op` pour TVA 20/10/5,5%)
  - `score_date()` : paliers symétriques ±0/±1/±3/±7/±14 → 1.0/0.95/0.80/0.50/0.20/0.0
  - `score_fournisseur()` : `max(substring, Jaccard, Levenshtein)` — Levenshtein via `difflib.SequenceMatcher` (seuil 0.5)
  - `score_categorie()` : inférence ML via `ml_service.predict_category(fournisseur)` (rules + sklearn fallback + confiance ≥0.5) comparée à `op.categorie` (1.0 / 0.6 / 0.0) ; retourne `None` si non-inférable → critère neutre
  - `compute_total_score()` : pondération `0.35*M + 0.25*F + 0.20*D + 0.20*C` ou redistribution `0.4375/0.3125/0.25` sur 3 critères si catégorie `None`
  - Les 4 sous-scores retournés dans `score_detail` à côté du total pour affichage frontend
  - `compute_score` signature étendue avec `override_categorie`/`override_sous_categorie` pour les sous-lignes ventilées ; tous les callers ventilés (`get_suggestions_for_operation`, `run_auto_rapprochement`, `get_suggestions_for_justificatif`, `get_batch_hints`, `get_batch_justificatif_scores`) propagent ces params
  - Frontend : nouveau composant `ScorePills` (components/justificatifs/ScorePills.tsx) qui affiche 3-4 pills colorées (M/D/F/C) + pill total compact, couleurs dynamiques (vert ≥0.8 / ambre ≥0.5 / rouge <0.5), delta jours inline sur la pill `D`, pill `C` masquée si `null`
  - Type `JustificatifScoreDetail` ajouté dans `types/index.ts`
  - Best-match highlight (bordure emerald) sur la 1ère suggestion si score ≥0.80, label « Meilleur match » (Sparkles icon) si ≥0.95

- **Rename service filename-first (backend)**
  - Nouveau module `backend/services/rename_service.py` qui porte la logique filename-first (ex-script one-shot désormais un thin CLI wrapper)
  - `CANONICAL_RE` : `^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(_[a-z0-9]+)*\.pdf$` (point décimal, suffix optionnel `_fs`/`_a`/`_2`)
  - `FACSIMILE_RE` : détection `_fs(_\d+)?\.pdf$` pour fac-similés
  - `is_canonical()`, `is_facsimile()` (détecte nouveau `_fs` + legacy `reconstitue_`)
  - `normalize_filename_quirks()` : gère `.pdf.pdf`, `NNpdf.pdf`, `name (1).pdf`
  - `try_parse_filename()` : 3 regex tolérantes (underscore, dash, pas de séparateur) avec garde-fous supplier non-générique, date plausible, montant ≤100 000 €
  - `build_from_parsed()` : reconstruit le nom canonique avec point décimal
  - `_load_ocr_cache()` : charge `.ocr.json`, supporte 2 shapes (OCR avec `status=success` + `extracted_data`, et reconstitue avec champs à la racine + `source: "reconstitue"`), retourne `(data, is_reconstitue)`
  - `compute_canonical_name(filename, ocr_data, source_dir, is_reconstitue)` : point d'entrée unifié, stratégie filename-first → OCR fallback, inject `_fs` pour les reconstitues
  - `scan_and_plan_renames(directory)` : scanner qui classifie en 6 buckets (canonique, safe, ocr, no_ocr, bad_supplier, no_date_amount), retourne `ScanPlan` TypedDict
  - `deduplicate_against()` : wrapper sur `naming_service.deduplicate_filename` avec self-collision check
  - `is_suspicious_supplier()` : filtre les OCR misread (liste `SUSPICIOUS_SUPPLIERS`, len < 3)
  - `justificatif_service.auto_rename_from_ocr()` réécrit pour déléguer à `compute_canonical_name()` — corrige les 3 cas bogués historiques : `openai_20250214_24.pdf` ne devient plus `_824,00.pdf`, `ldlc-20250524_409.90.pdf` ne devient plus `sasu-au-capital-de-10-500-000_*`, `curso20250815_23.85.pdf` ne devient plus `visa-2955_*`

- **Convention point décimal**
  - Migration virgule → point : `fournisseur_YYYYMMDD_montant.XX.pdf` (au lieu de `montant,XX`)
  - `naming_service.build_convention_filename()` retire le `.replace(".", ",")` (garde le point naturel)
  - `rename_service.CANONICAL_RE` échappe `\.`
  - Self-healing : les 130 fichiers en virgule sont automatiquement convertis au prochain `scan-rename` (parser accepte `[.,]`, rebuild en point)
  - CLAUDE.md, README.md, naming_service docstring, architecture.md mis à jour
  - 137 fichiers `en_attente` + 238 fichiers `traites` au format canonique point après migration

- **Fac-similé `_fs` suffix**
  - Nouveau format `supplier_YYYYMMDD_montant.XX_fs.pdf` (au lieu de `reconstitue_YYYYMMDD_HHMMSS_supplier.pdf`)
  - `template_service.generate_reconstitue()` construit désormais via `naming_service.build_convention_filename` + injection `_fs` avant `.pdf`, fallback timestampé uniquement si date/montant manquants
  - Les fac-similés sont désormais **parsables par le moteur de scoring** (supplier/date/montant extraits du filename) — ils remontent correctement dans les suggestions de rapprochement
  - `rename_service.is_facsimile()` détecte les 2 formats (nouveau `_fs` + legacy `reconstitue_`) pour période de migration
  - Frontend `isReconstitue()` dans `lib/utils.ts` réécrit : `/_fs(_\d+)?\.pdf$/i` OR `startsWith('reconstitue_')`
  - Backend `ged_service.py:612`, `ocr_service.py:278`, `export_service.py:58` utilisent `rename_service.is_facsimile()` pour la détection (via lazy import pour éviter les circulaires)
  - Migration des 10 reconstitue_* existants via scan-rename endpoint — 11/13 migrés automatiquement (2 Ibis Hotel sans date/montant OCR restent en legacy, transparent pour l'UI)

- **Endpoint scan-rename on-demand**
  - `POST /api/justificatifs/scan-rename` avec params : `apply: bool = False`, `apply_ocr: bool = False`, `scope: "en_attente"|"traites"|"both" = "both"`
  - Dry-run par défaut, retourne le plan sans modifier le filesystem
  - `scope=both` fusionne les 2 dossiers (`en_attente` + `traites`), scan 398 fichiers
  - Sur `apply=true` : itère `to_rename_from_name` (+ `to_rename_from_ocr` si `apply_ocr=true`), appelle `rename_justificatif()` qui met à jour PDF + .ocr.json + ops refs + GED metadata
  - Retourne `{scope, scanned, already_canonical, to_rename_safe, to_rename_ocr, skipped: {no_ocr, bad_supplier, no_date_amount}, applied?: {ok, errors, renamed}}`
  - Route placée AVANT `/{filename}/rename` et `/{filename}` pour éviter la capture FastAPI

- **ScanRenameDrawer + bouton OCR Historique**
  - Nouveau composant `frontend/src/components/ocr/ScanRenameDrawer.tsx` (680px)
  - Bouton **orange « Scanner & Renommer »** (bg-warning + Wand2 icon) dans la barre de filtres de l'onglet Historique de la page OCR
  - Au mount du drawer : appelle `useScanRename()` (dry-run) → loader → affiche 3 cartes résumé (scannés / déjà canoniques / à renommer)
  - Section SAFE (emerald) : renames parsés depuis le filename (toujours appliqués)
  - Section OCR (warning orange) : renames reconstruits depuis l'OCR, **checkbox opt-in** « Inclure les renames OCR dans l'application »
  - Section Skipped collapsible : 3 sous-listes (no_ocr, bad_supplier, no_date_amount)
  - Bouton « Appliquer » dans footer → `useApplyScanRename({ applyOcr })` → invalidation caches TanStack (`justificatifs`, `justificatif-stats`, `ocr-history`, `ocr-status`, `pipeline`) + toast succès/erreurs
  - 2 hooks séparés : dry-run (pas d'invalidation) + apply (invalidation)
  - `useApplyScanRename` déclenche un refresh post-mutation pour refléter l'état final
  - Auto-ferme le drawer quand tout est appliqué

- **Script CLI thin wrapper**
  - `scripts/rename_justificatifs_convention.py` réduit à un wrapper CLI qui importe `rename_service` (source de vérité unique partagée avec le backend et l'endpoint)
  - Conserve les flags `--dry-run`, `--force-generic`, `--apply-ocr`

- **Recherche multifocale OCR Historique**
  - Input texte dans la barre de filtres à droite du dropdown fournisseur dans `HistoriqueTab` de `OcrPage`
  - Debounce 250ms
  - Parent fetch parallel via `useQueries` sur les reverse-lookups de tous les items de l'année (même queryKey que `HistoriqueOperationCell` → React Query dédoublonne, zéro surcoût réseau)
  - Haystack normalisé lowercase + NFD + strip diacritics (accent-insensitive) : `supplier` OCR, `best_amount` (3 variantes `107`/`107.00`/`107,00`), `libelle`/`categorie`/`sous_categorie` de l'op liée (via reverse-lookup), `debit`/`credit` comptables
  - **Filename exclu** du haystack pour éviter les faux positifs (ex. `20251107` matchant "107")
  - **Multi-termes AND logic** via `split(/\s+/)` + `every()` : `"uber 41"` match les lignes avec à la fois `uber` ET `41`
  - Placeholder : « Rechercher (libellé, catégorie, montant…) »
  - Bouton × pour effacer (visible uniquement si texte saisi)
  - `vehicule` (sans accent) matche `Véhicule` (accent-insensitive)

- **Navigation OCR → Justificatifs (« Voir l'opération »)**
  - `JustificatifOperationLink.tsx` : bouton « Voir l'opération » navigate désormais vers `/justificatifs?file=X&highlight=Y&filter=avec` (au lieu de `/editor?file=X&highlight=Y`)
  - `PendingView` bouton « Rechercher manuellement » navigate vers `/justificatifs?filter=sans&year=Y&month=M` (année/mois extraits du filename canonique)
  - `useJustificatifsPage` lit les params URL : `file` → year/month sync, `highlight` → `selectedOpIndex`/`selectedOpFilename`, `filter` → `justifFilter`, + fallback `year`/`month` directs
  - `JustificatifsPage` : nouvelle logique `isNavTarget` dérivée de `selectedOpIndex`/`selectedOpFilename` dans le `map` des rows, ajoutée à `isSelected` → **surlignage persistant** `bg-warning/15 outline-warning` tant que la navigation cible cette row (ne dépend plus de `drawerOpen`/`previewJustif`)
  - `useEffect` scroll-into-view via `useRef` anti-re-scroll, re-run au chargement des operations
  - **Auto-open du drawer preview retiré** (chargeait le PDF via `<object>` ce qui ralentissait le chargement) — la row surlignée persistante suffit, user clique l'icône justif pour voir le PDF s'il le souhaite
  - Effect preview réduit à un simple cleanup URL (retire `preview`/`vl` sans ouvrir de drawer) ; on garde `file`/`highlight`/`filter` dans l'URL pour que `selectedFile` reste stable et que le row cible reste surligné après close drawer

- **PendingView Associer fix**
  - `JustificatifOperationLink.PendingView.handleAssociate()` utilise désormais `getScoreValue(s.score)` pour extraire le total numérique (le backend retourne `score` comme objet MatchScore `{total, detail, confidence_level}`)
  - Forwards `ventilation_index` au backend pour les sous-lignes ventilées
  - `useManualAssociate` mutation signature étendue avec `ventilation_index?: number | null`
  - Type `OperationSuggestion.score` updated: `number | { total: number; confidence_level?; detail? }`
  - Toast success/error ajouté pour feedback utilisateur
  - Fix 422 Pydantic error qui bloquait silencieusement l'association

- **Year-wide mode édition catégorie**
  - `JustificatifsPage.handleCategoryChange()` : suppression du guard `if (isYearWide) return` qui bloquait l'édition en mode « Toute l'année »
  - `<select Catégorie>` et `<select Sous-catégorie>` : suppression de `disabled={isYearWide}`
  - `queryClient.fetchQuery` avec `queryFn: () => api.get(\`/operations/\${op._filename}\`)` explicite pour garantir le fetch si cache invalide
  - Utilise `op._filename` + `op._originalIndex` peuplés par `useJustificatifsPage.enrichedOps` pour identifier le fichier cible et l'index
  - Sous-catégorie dropdown toujours rendu (plus de fallback `<span>` text-only), avec préservation de la valeur actuelle via injection d'une option supplémentaire si `currentSub` pas dans `subcategoriesMap`

- **Dropdown mois « Toute l'année » visual fix**
  - `value={selectedMonth !== null ? selectedMonth : (selectedFile?.month ?? '')}` (priorité à `selectedMonth` qui inclut `0`)
  - Avant : `value={selectedFile?.month ?? selectedMonth ?? ''}` → fallback sur `monthsForYear[0]` (Janvier) en mode year-wide, dropdown affichait « Janvier » alors que les ops étaient en mode year-wide

- **Exemptions justificatifs**
  - `useJustificatifsPage` expose `isOpExempt(op)` basé sur `appSettings.justificatif_exemptions`
  - Row rendering : si exempt, icône `CheckCircle2` **bleu ciel** (`text-sky-400`) au lieu de `Circle` ambre, tooltip « Catégorie X exemptée — pas de justificatif requis », bouton disabled, pas de cursor pointer, pas de checkbox batch, click handler early return
  - Filter `sans`/`avec` exclut/inclut les exempts correctement
  - `selectableOps` exclut les exempts pour la sélection batch

- **Performance drawer (lazy-mount + IntersectionObserver)**
  - `RapprochementWorkflowDrawer` : subtree interne lazy-monté via flag `hasBeenOpened` — avant le 1er open, `{!hasBeenOpened ? null : <>...</>}` évite les fetches eager au mount (`ReconstituerButton` avec `useTemplateSuggestion`, etc.)
  - `Thumbnail` component utilise `IntersectionObserver` (rootMargin 200px) pour ne charger l'`<img>` qu'au moment où la vignette entre dans le viewport du scroll container — avant : 30+ `<img>` simultanés au drawer open, maintenant ~5 (rows visibles) puis au fil du scroll
  - Placeholder `FileText` icon 16px affiché tant que l'image n'est pas chargée, ou si `onError`
  - Résultat : 0 thumbnails fetched au chargement de `/justificatifs`, 5 au drawer open (rows visibles initialement)

- **Orange prix + date suggestions**
  - `SuggestionRow` et `SearchResultRow` du `RapprochementWorkflowDrawer` : date (`formatShortDate(ocr_date)`) et prix (`formatCurrency(ocr_montant)`) rendus en `text-warning font-medium` (orange) au lieu de `text-text-muted`
  - Hiérarchie visuelle plus claire : fournisseur (blanc, gros) / date+montant (orange) / score pills (colorées)

- **OCR reprocess script + 4 Uber HTML-masked**
  - `scripts/reprocess_orphan_ocr.py` : scan tous les PDFs dans `en_attente/` sans `.ocr.json` associé, lance OCR on-demand
  - 61 orphelins traités, 55 Uber correctement OCR-isés
  - 4 Uber HTML-masked identifiés (fichiers HTML renommés `.pdf`, tous 635379 octets) — signalés pour re-téléchargement manuel depuis Uber

- **Backend détection fac-similé unifié**
  - `ged_service.py:612` : `is_reconstitue = rename_service.is_facsimile(basename)` (au lieu de `startswith("reconstitue_")`)
  - `ocr_service.py` : nouveau helper `_detect_facsimile()` via lazy import de `rename_service.is_facsimile` (évite circular imports)
  - `export_service.py:58` : même pattern pour le tag `[R]` dans les exports comptables

- **Fichiers supprimés**
  - `frontend/src/components/rapprochement/RapprochementManuelDrawer.tsx` (fusionné)
  - `frontend/src/components/justificatifs/JustificatifAttributionDrawer.tsx` (fusionné)
  - `frontend/src/components/rapprochement/RapprochementPage.tsx` (orphelin, `/rapprochement` redirige vers `/justificatifs`)
  - `frontend/src/hooks/useRapprochementManuel.ts` (fusionné dans `useRapprochementWorkflow.ts`)

### Added (2026-04-10) — Session 9

- **Auto-rename justificatifs post-OCR**
  - Convention `fournisseur_YYYYMMDD_montant,XX.pdf` (virgule decimale)
  - Nouveau `naming_service.py` : `normalize_supplier()`, `build_convention_filename()`, `deduplicate_filename()`
  - `auto_rename_from_ocr()` dans justificatif_service : renomme apres OCR (sandbox, batch upload, upload direct)
  - `rename_justificatif()` : renomme PDF + .ocr.json + associations operations + GED metadata
  - Endpoint `POST /api/justificatifs/{filename}/rename` pour renommage manuel
  - Regex `_parse_filename_convention` accepte virgule et point
  - SSE event enrichi (`auto_renamed`, `original_filename`)
  - Idempotent : ne re-renomme pas les fichiers deja conformes

- **FilenameEditor frontend**
  - Composant inline-editable avec suggestion convention OCR (bouton Sparkles)
  - Badge "auto" (icone Wand2) si fichier auto-renomme
  - Integre dans l'historique OCR et le drawer justificatif
  - Hook `useRenameJustificatif()` avec invalidation queries

- **Apercu PDF hover dans historique OCR**
  - Icone oeil par ligne → popover 300×400px au survol (delai 300ms)
  - Iframe PDF inline via endpoint `/preview`

- **Historique OCR trie par date de traitement**
  - Tri par `processed_at` (timestamp OCR) au lieu du nom de fichier
  - Plus recent en premier (desc par defaut)

- **Filtres Templates justificatifs**
  - Section Bibliotheque : recherche texte (fournisseur/categorie) + dropdown categorie + reset
  - Section Creer : recherche texte + dropdown mois (date OCR) + compteur + apercu PDF drawer lateral

- **Template HTML email comptable brande**
  - Template externe `backend/templates/email_template.html` (tables, compatible Gmail/Outlook)
  - En-tete : logo lockup 200px entre filets violets #534AB7, titre contextuel
  - Mention "Email genere par NeuronXcompta" en italique
  - Introduction contextuelle (accord pluriel, type documents)
  - Arborescence ZIP : lecture reelle via `_build_zip_tree()` ou simulee via `_build_doc_tree()`
  - Signature + footer copyright icone + NeuronXcompta
  - Logos CID pour envoi reel, base64 data-URI pour preview iframe
  - Toggle HTML/Texte dans le drawer (boutons segmentes)
  - Preview retourne `corps_html` en plus de `corps`
  - Fix 422 preview : nouveau `EmailPreviewRequest` (documents seuls, sans destinataires)

- **Deduplication rapports avec archivage**
  - `REPORTS_ARCHIVES_DIR = data/reports/archives/`
  - `_archive_report()` : deplace l'ancien fichier au lieu de le supprimer
  - Suffixe `_archived_YYYYMMDD_HHMMSS` + metadonnees dans `archives_index.json`
  - Archives non indexees dans la GED (backup silencieux)

- **Tri documents drawer email par periode**
  - Chaque groupe (exports, rapports, etc.) trie par date croissante (jan→dec)

### Added (2026-04-09) — Session 8

- **Batch reconstitution fac-simile depuis JustificatifsPage**
  - Multi-selection checkboxes sur le tableau des operations (ops sans justificatif uniquement)
  - Checkbox header select-all avec etat intermediaire (indeterminate)
  - Barre d'actions flottante en bas : "N operations selectionnees" + bouton "Reconstituer (N)" + annuler
  - `BatchReconstituerDrawer` (550px) : affiche les ops groupees par template suggere avec dropdown modifiable
  - Matching template intelligent : priorite categorie/sous-categorie du template, fallback alias fournisseur
  - Ops sans template correspondant affichees en warning ambre
  - Generation sequentielle par groupe via `POST /api/templates/batch-generate`
  - Toast resultat (succes/erreurs) + clear selection automatique

- **Nouvel endpoint `POST /api/templates/batch-suggest`**
  - Accepte une liste `{operation_file, operation_index}[]`
  - Groupe les operations par meilleur template : `_suggest_by_category()` (match categorie) puis `suggest_template()` (alias)
  - Retourne `{groups: [{template_id, template_vendor, operations}], unmatched: [...]}`
  - Modeles Pydantic : `BatchSuggestRequest`, `BatchSuggestGroup`, `BatchSuggestResponse`

- **Fac-simile : rectangle blanc elargi dynamiquement**
  - Le rectangle blanc couvrant l'ancien montant est desormais `max(largeur_coordonnees, largeur_texte_formate + padding)`
  - Padding 4pt horizontal + 2pt vertical pour marge de securite
  - Corrige le cas ou l'ancien montant du ticket source debordait du rectangle (ex: "111,19" non couvert par un rectangle de 34pt)

### Added (2026-04-09) — Session 7

- **Export Compte d'Attente**
  - Nouveau service dédié `alerte_export_service.py` : génération PDF et CSV des opérations en compte d'attente
  - Export par mois (`compte_attente_janvier.pdf`) ou par année (`compte_attente_2025.pdf`)
  - PDF professionnel : logo, tableau 7 colonnes, alternance couleurs, récapitulatif par type d'alerte, footer paginé
  - CSV : BOM UTF-8, séparateur `;`, CRLF, montants FR, 8 colonnes avec totaux
  - Cas 0 opérations : fichier généré quand même (preuve mois clean pour le comptable)
  - Enregistrement automatique dans la GED comme rapport (`report_type: "compte_attente"`)
  - Déduplication à la régénération (écrasement fichier + mise à jour entrée GED)
  - Endpoints : `POST /api/alertes/export`, `GET /api/alertes/export/download/{filename}`
  - Modèles Pydantic : `AlerteExportRequest`, `AlerteExportResponse`

- **Intégration Export Comptable ↔ Compte d'Attente**
  - Nouveau champ `include_compte_attente: bool = True` dans `GenerateExportRequest` et `GenerateMonthRequest`
  - Chaque ZIP d'export comptable inclut automatiquement `compte_attente/` (PDF + CSV)
  - Checkbox "Compte d'attente" précochée dans ExportPage (barre d'action)

- **Export Comptable enregistré dans la GED**
  - Les fichiers `Export_Comptable_{Mois}.pdf/csv` sont copiés en standalone dans `data/reports/`
  - Enregistrement automatique dans la GED via `register_rapport()` avec déduplication
  - Exclusion des préfixes `export_comptable_` et `compte_attente_` du scan `_find_existing_reports()` pour éviter les doublons dans le ZIP

- **AlertesPage — Bouton export dropdown**
  - Bouton "Exporter" avec dropdown 4 options : PDF/CSV mois sélectionné + PDF/CSV année
  - Spinner pendant la génération, toast succès + téléchargement auto
  - Fermeture dropdown au clic extérieur

- **Drawer Envoi Comptable — Améliorations UX**
  - **Expanders intelligents** : groupes ≥10 docs repliés par défaut, petits groupes ouverts
  - Badge compteur sélection visible quand un groupe est replié
  - **Ordre de groupes** : Exports → Rapports → Relevés → Justificatifs → Documents (les plus pertinents en premier)
  - **Jauge taille temps réel** : barre progression dans le footer gauche (bleue / ambre à 80% / rouge si > 25 Mo)
  - **Pré-sélection intelligente** : ouverture depuis Export Comptable pré-coche le dernier export + tous les rapports, filtre Exports+Rapports actifs

- **Historique exports trié par mois**
  - Tri par année (desc) puis par mois croissant (jan → déc) au lieu de l'ordre API

- **Justificatifs — Catégories éditables inline**
  - Colonnes Catégorie et Sous-catégorie devenues des dropdowns select éditables
  - Sous-catégorie dynamique selon la catégorie sélectionnée
  - Sauvegarde automatique via `useSaveOperations` au changement
  - Désactivé en mode "Toute l'année" (lecture seule)

### Fixed (2026-04-09) — Session 7

- Exclusion `reports_index.json.migrated` du listing documents email
- Fix doublons dans le ZIP d'export comptable (exports et comptes d'attente n'apparaissent plus dans `rapports/`)

### Added (2026-04-08) — Session 6

- **Titre automatique des rapports**
  - Fonction `buildReportTitle()` dans ReportsPage : compose titre à partir catégories + période
  - Règles : 1 cat = nom exact, 2-4 = liste virgule, 5+ = 3 premières + compteur, toutes = "Toutes catégories"
  - Champ titre éditable avec flag `titleManuallyEdited` (auto-reprend si vidé)
  - Batch 12 mois utilise `buildReportTitle` par mois

- **Refonte Export Comptable V3**
  - Réécriture complète de ExportPage : 2 onglets (Générer des exports / Historique)
  - Grille calendrier 4×3 avec `ExportMonthCard` (3 états : pas de données / à générer / prêt)
  - Badges toggle PDF + CSV par mois (les deux activés par défaut)
  - Bouton unique "Exporter" → génère un ZIP contenant toujours PDF+CSV
  - Architecture ZIP : racine (operations.pdf + operations.csv), dossiers `releves/`, `rapports/`, `justificatifs/`
  - Preview contenu dans chaque carte (nb relevés, rapports, justificatifs)
  - Historique : expander contenu ZIP avec noms enrichis (relevés → "Relevé Mois Année")
  - Sélection multi-export dans l'historique + bouton "Envoyer au comptable"
  - Bouton "Envoyer au comptable" dans le PageHeader
  - Backend : `GET /status/{year}`, `POST /generate-month`, `POST /generate-batch`, `GET /contents/{filename}`, `GET /available-reports/{year}/{month}`
  - `exports_history.json` pour le logging des exports
  - Suppression du format Excel (XLSX)

- **Email Comptable — Drawer universel d'envoi**
  - Drawer 2 colonnes : sélection documents + composition email
  - Filtres par type (chips toggleables : Exports, Rapports, Relevés, Justificatifs, Documents GED)
  - Filtres par période (année + mois)
  - Recherche texte
  - Composition : destinataires chips (pré-remplis depuis settings), objet + corps auto-générés, pièces jointes listées, jauge 25 Mo
  - Envoi : tous documents zippés en un seul `Documents_Comptables_*.zip`
  - Email HTML avec logo en-tête (`logo_lockup_light_400.png` CID inline) + footer copyright (`logo_mark_64.png` + © année)
  - Fallback texte brut pour clients email non-HTML
  - Onglet Historique dans le drawer : cartes expansibles (date, destinataires, objet, statut, liste documents)
  - Store Zustand `sendDrawerStore` pour ouverture globale avec pré-sélection
  - Accessible depuis : sidebar (sous Pipeline, badge bleu), page Exports, page GED
  - Configuration SMTP dans Paramètres > Email (nouvel onglet) : Gmail + app password + nom expéditeur + destinataires chips
  - Backend : `email_service.py` (SMTP, résolution multi-type, listing documents), `email_history_service.py` (log/lecture/couverture)
  - Endpoints : `POST /test-connection`, `GET /documents`, `POST /preview`, `POST /send`, `GET /history`, `GET /coverage/{year}`
  - Composant réutilisable `EmailChipsInput` (validation email, ajout/suppression, Backspace)

- **Noms enrichis des relevés bancaires**
  - Mapping hash → "Relevé Mois Année" depuis les fichiers d'opérations
  - Appliqué dans le drawer envoi, le contenu ZIP de l'historique, et le listing documents

### Added (2026-04-08) — Session 5

- **Navigation bidirectionnelle Justificatif <-> Operation**
  - Nouveau endpoint `GET /api/justificatifs/reverse-lookup/{filename}` : trouve les operations liees a un justificatif
  - Composant `JustificatifOperationLink` : bouton "Voir l'operation" (orange) pour justificatifs associes, suggestions d'operations pour justificatifs en attente
  - Integration dans GED drawer, OCR historique, Rapprochement log
  - EditorPage : support `?file=X&highlight=Y` avec scroll + surbrillance permanente (outline orange)

- **GED V3 — Arborescence fournisseur + justificatifs en attente**
  - Fix arborescence fournisseur : clics fonctionnels sur tous les onglets (bug `parentLabel` non destructure)
  - Justificatifs en attente inclus dans la GED (237 docs au lieu de 104)
  - Badge "EN ATTENTE" ambre sur les cartes de justificatifs non attribues
  - Enrichissement automatique des metadata depuis le nom de fichier (convention `fournisseur_YYYYMMDD_montant.pdf`)
  - Suppression de rapports depuis la GED (delegation a `report_service.delete_report()`)

- **Templates justificatifs — Fac-simile PDF**
  - Modele `FieldCoordinates` (x, y, w, h, page) sur `TemplateField`
  - Extraction automatique des coordonnees via pdfplumber `extract_words()`
  - Generation fac-simile : rasterisation du PDF source + masquage images produits + remplacement date/montant
  - Fallback sur PDF sobre ReportLab si pas de coordonnees
  - Preview templates dans la bibliotheque (thumbnail + drawer detail avec champs et coordonnees)
  - Section "Generer" : dropdowns fichier/operation (filtre par annee + sans justificatif uniquement)
  - Suppression des champs TVA (non assujetti)
  - Fix page noire (bug `key={s}` sur objets sous-categories)

- **Rapprochement / Justificatifs — Fusion et ameliorations**
  - Page Rapprochement supprimee de la sidebar (redirection `/rapprochement` -> `/justificatifs`)
  - Page Justificatifs utilise le `RapprochementManuelDrawer` (filtres, scores, preview PDF)
  - EditorPage utilise le meme drawer pour l'attribution de justificatifs
  - Clic trombone vert dans Editeur/Justificatifs : preview PDF + bouton Dissocier + bouton Ouvrir Apercu
  - Clic trombone gris/ambre : drawer attribution (inchange)
  - Suggestions filtrees par mois de l'operation (tolerance +/- 1 mois)
  - Surbrillance orange sur la ligne selectionnee dans Editeur et Justificatifs

- **Pipeline — Navigation contextuelle**
  - Toutes les etapes passent `?file=operationsXXX.json` aux pages destination
  - Page Justificatifs lit `?file=` pour pre-selectionner le bon mois
  - Etape 4 renommee "Lettrage" (pointe vers `/justificatifs`)
  - Pipeline en evidence dans la sidebar (badge orange avec %)
  - Bouton "Voir justificatifs" en badge orange dans l'etape 3
  - Etape 2 Categorisation : passe `?file=X&filter=uncategorized`

- **Auto-pointage des operations completes**
  - Setting `auto_pointage: bool = True` dans `AppSettings`
  - `auto_lettre_complete()` : pointe les ops avec categorie + sous-categorie + justificatif (ventilees : toutes sous-lignes completes)
  - Integre dans 4 points : PUT operations, POST categorize, POST associate, POST associate-manual
  - Toggle "Auto-pointage" dans le header Dashboard (vert/gris)
  - Toast informatif dans EditorPage apres save

- **Operations "Perso" auto-justifiees**
  - `_mark_perso_as_justified()` : auto-marque `Justificatif=true` pour les ops categorie "Perso"
  - Appele automatiquement a chaque save d'operations

- **Rapports — Categories Perso et Non categorise**
  - Checkboxes "Perso" et "Non categorise" dans le selecteur de categories
  - Backend `_apply_filters` gere `__non_categorise__` (ops sans categorie ou "Autres")

- **Sandbox — Traitement parallele**
  - `process_existing_files()` utilise `ThreadPoolExecutor(max_workers=3)` au lieu de sequentiel
  - Nouveau endpoint `POST /api/sandbox/process` pour declenchement manuel

- **OCR Historique — Filtres et pleine largeur**
  - Filtres par annee (store global), mois, fournisseur
  - Date extraite du nom de fichier (convention YYYYMMDD)
  - Colonnes triables (date, fournisseur, confiance)
  - Page OCR en pleine largeur

- **Toast rapprochement auto design**
  - Toast avec icone, compteurs colores (associations auto + suggestions manuelles + restants en attente)
  - Reste visible 15 secondes avec bouton fermer

- **Export Comptable — Nommage simplifie**
  - Format `Export_Comptable_ANNEE_Mois.{csv,pdf,zip}` (sans le numero de mois)

- **UI/UX**
  - Focus-within orange dans l'editeur (remplace le bleu)
  - Surbrillance orange permanente pour la ligne highlight depuis la GED
  - Selection checkbox orange dans l'editeur

### Added (2026-04-07) — Session 4

- **GED V2 — Hub documentaire unifie** : refonte complete de la bibliotheque documents
  - **Backend modele enrichi** : nouveaux champs `PeriodInfo`, `RapportMeta`, `fournisseur`, `date_document`, `date_operation`, `period`, `montant`, `ventilation_index`, `is_reconstitue`, `operation_ref`, `rapport_meta` sur `GedDocument`
  - **5 vues arbre** : `by_period` (annee/trimestre/mois), `by_year` (annee/type/mois), `by_category` (categorie/sous-categorie), `by_vendor` (fournisseur/annee), `by_type` (releves/justificatifs en attente+traites/rapports par format/docs libres)
  - **Enrichissement automatique metadata** :
    - `enrich_metadata_on_association()` : apres rapprochement auto/manuel → categorie, fournisseur, montant, period, operation_ref
    - `enrich_metadata_on_ocr()` : apres OCR → fournisseur, date_document, montant
    - `propagate_category_change()` : au save editeur → sync categorie aux justificatifs lies
    - `clear_metadata_on_dissociation()` : au dissociate → reset champs enrichis
    - `backfill_justificatifs_metadata()` : enrichissement one-shot des justificatifs traites existants au scan
  - **Rapports integres dans la GED** : `register_rapport()` appele apres generation, `migrate_reports_index()` migration one-shot depuis `reports_index.json`
  - **Nouveaux endpoints** : `GET /pending-reports`, `POST /documents/{id}/favorite`, `POST /documents/{id}/regenerate`, `POST /documents/compare-reports`
  - **Filtres documents enrichis** : quarter, categorie, sous_categorie, fournisseur, format_type, favorite — recherche full-text inclut titres/descriptions rapports + fournisseur
  - **Stats enrichies** : `par_categorie`, `par_fournisseur`, `par_type`, `non_classes`, `rapports_favoris`
  - **Mapping `POSTE_TO_CATEGORIE`** : 16 postes → categorie comptable pour classement docs libres dans l'arbre categorie
  - **Nettoyage fournisseurs** : `_clean_fournisseur()` supprime guillemets/espaces parasites des donnees OCR
  - **Frontend** :
    - `GedTreePanel` : 5 onglets icones avec derivation filtres automatique depuis node IDs
    - `GedFilterBar` : barre filtres croises (type, categorie, fournisseur, recherche) avec dropdowns compteurs et reset
    - `GedDocumentCard` : carte enrichie (thumbnail, badge categorie, fournisseur, periode, montant, badge reconstitue, etoile favori)
    - `GedReportDrawer` : drawer rapport 800px (preview PDF, favori, re-generation, telechargement, suppression)
    - `GedPage` reecrit : 5 onglets arbre, filtres croises, mode comparaison, drawer contextuel rapport/document, init filtres via URL params
    - Types enrichis : `PeriodInfo`, `RapportMeta`, `GedDocument` enrichi, `GedTreeResponse` (5 vues), `GedStats` enrichi, `GedFilters` enrichi
    - Hooks V2 : `useGedPendingReports`, `useToggleReportFavorite`, `useRegenerateReport`, `useCompareReports`
  - **ReportsPage simplifie** : onglet Bibliotheque supprime, bouton "Voir dans la bibliotheque" → `/ged?type=rapport`
  - **Integrations backend** : rapprochement_service, report_service, operations router, justificatifs router, ocr_service, reports router (delete → remove GED)

### Added (2026-04-06) — Session 3

- **Refonte Export Comptable (CSV + PDF)** : regles comptables strictes, format professionnel
  - Nouvelle fonction `_prepare_export_operations()` : classe les operations en 3 groupes (pro/perso/attente)
  - Ventilations explosees en sous-lignes avec suffixe `[V1/N]`
  - Ops "perso" exclues des totaux BNC (section separee "Mouvements personnels")
  - Ops sans categorie / "Autres" en compte d'attente (section separee)
  - CSV : separateur `;`, UTF-8 BOM, CRLF, montants FR (`1 234,56`), colonne Justificatif = nom fichier PDF, pas de lignes `#`
  - PDF : logo en haut a gauche, 7 colonnes, montants alignes droite, 3 sections colorees, recapitulatif BNC, footer pagine (`Page X/Y`)
  - Nommage : `Export_Comptable_YYYY-MM_Mois.{csv,pdf}` (retrocompatibilite ancien format)
  - Helpers : `_format_amount_fr()`, `_export_filename()`, `_safe_float()`

- **Auto-alimentation ML depuis corrections manuelles** : apprentissage automatique au save
  - `ml_service.add_training_examples_batch()` : ajout batch deduplique dans `training_examples.json`
  - `ml_service.update_rules_from_operations()` : mise a jour `exact_matches` + `subcategories` dans le modele a regles
  - Handler PUT `/api/operations/{filename}` : extrait les operations categorisees au save et alimente le ML
  - Effet immediat : nouvelles regles exactes actives des le prochain auto-categorize
  - Effet differe : "Entrainer + Appliquer" utilise les nouvelles donnees d'entrainement
  - Filtre : exclut vide, "Autres", "Ventile" — deduplication par couple `(libelle, categorie)`

- **Fix ajout ligne EditorPage** : la nouvelle ligne apparait toujours en haut du tableau
  - Reset des filtres colonnes, recherche globale, et filtre "Non categorisees" a l'ajout
  - Tri bascule en date decroissante + pagination remise a page 0

- **Bouton "Ouvrir dans Apercu/Numbers" (Rapports)** : ouverture native des fichiers
  - Backend : endpoint `POST /reports/{filename}/open-native` avec `subprocess.Popen(["open", ...])`
  - Frontend : hook `useOpenReportNative()`, bouton dans `ReportPreviewDrawer` et `ReportGallery`
  - Label adapte au format : "Ouvrir dans Apercu" (PDF), "Ouvrir dans Numbers" (CSV), "Ouvrir dans Excel" (XLSX)

- **Refonte Rapports — Generation** : checkboxes modernes + batch
  - Remplacement `<select multiple>` par checkboxes toggle (18px, Check/Minus icons, pastilles couleur)
  - Checkbox "Tout selectionner" en premiere ligne avec etat intermediaire (tiret) et compteur `N/17`
  - Meme systeme pour les sous-categories
  - Bouton "Batch (12 mois)" : genere un rapport par mois pour l'annee selectionnee avec toast progression
  - Titres ameliores : 2-4 categories listees, 5+ tronquees avec `(+N)` (ex: "URSSAF, CARMF, Honoraires… (+3) — Mars 2025")

- **Refonte Rapports — Bibliotheque** : checkboxes modernes + export comptable + suppression
  - Checkboxes toggle modernes sur chaque carte (18px, remplacement `<input type="checkbox">`)
  - Toolbar : checkbox "Tout selectionner" avec etat intermediaire + compteur selection
  - Arborescence simplifiee : 2 onglets (Par date / Par categorie) au lieu de 3
  - Bouton "Exporter pour le comptable (N)" : cree un ZIP des rapports coches via `POST /reports/export-zip`
  - Bouton "Tout supprimer" avec toast de confirmation centre (`top-center`, 10s)
  - Suppression individuelle : toast de confirmation centre (remplace le double-clic)
  - Backend : endpoints `POST /reports/export-zip`, `DELETE /reports/all`, `POST /reports/regenerate-all`

- **Logo dans les rapports PDF** : logo `logo_lockup_light_400.png` en haut a gauche
  - Charge depuis `backend/assets/`, fallback graceful si absent
  - Ajoute dans `_generate_pdf_v2()` (rapports) et `_generate_pdf_content()` (exports)

- **Colonne Justificatif dans les rapports** : traçabilite des pieces justificatives
  - CSV : 8eme colonne `Justificatif` avec nom du fichier PDF ou vide, ratio dans les totaux (`12/89`)
  - PDF : colonne `Just.` avec checkbox ☑ vert + nom fichier ou ☐ gris, ratio dans les totaux

- **Colonne Commentaire dans les rapports** : notes utilisateur exportees
  - CSV : 9eme colonne `Commentaire` avec texte libre
  - PDF : colonne `Commentaire` en italique 6pt, tronquee a 40 chars

### Added (2026-04-06) — Session 2

- **Checkboxes modernes (EditorPage)** : remplacement des `<input type="checkbox">` natifs par des boutons toggle stylises
  - Carres arrondis 22px avec `border-2`, icone blanche quand coches, bordure coloree subtile quand decoches
  - Selection : fond `primary` + icone `Check`
  - Important : fond `warning` + icone `Star`, bordure ambre au repos
  - A revoir : fond `danger` + icone `AlertTriangle`, bordure rouge au repos
  - Pointee : fond `emerald-500` + icone `CheckCircle2`
  - Composant `CheckboxCell` generique avec props `colorClass`, `uncheckedColor`, `icon`

- **Tri sur les colonnes badge (EditorPage)** : les 4 colonnes badge sont desormais triables
  - Justificatif (trombone), Important (etoile), A revoir (triangle), Pointee (cercle)
  - `sortingFn` custom : tri boolean `Number(value || 0)`
  - Fleches de tri visibles dans le header au clic

- **Navigation Pipeline → Editeur filtree** : clic "Ouvrir l'editeur" sur l'etape Categorisation navigue vers `/editor?filter=uncategorized`
  - EditorPage lit le param `?filter=uncategorized` et active un filtre custom sur la colonne Categorie
  - `filterFn` custom : `__uncategorized__` matche les operations vides ou "Autres"
  - Panneau filtres ouvert automatiquement avec dropdown positionne sur "Non categorisees"
  - Bandeau warning "Filtre actif : operations non categorisees (N resultats)" avec bouton "Retirer le filtre"
  - Option "Non categorisees" ajoutee au dropdown categorie du panneau filtres

- **Auto-rapprochement justificatifs** : association automatique justificatif ↔ operation apres upload
  - `_run_ocr_background()` (justificatifs.py) chaine `run_auto_rapprochement()` apres OCR
  - `batch_upload()` (ocr.py) lance le rapprochement auto apres la boucle OCR
  - `_process_file()` (sandbox_service.py) lance le rapprochement auto apres OCR watchdog
  - Les 3 points d'entree (upload justificatifs, upload OCR, sandbox) declenchent automatiquement l'association

- **Bouton "Associer automatiquement" (JustificatifsPage)** : bandeau CTA contextuel
  - Bandeau ambre gradient visible quand `stats.sans > 0` avec compteur dynamique
  - Bouton `bg-warning` avec shadow, hover scale et icone Zap
  - Toast custom cliquable quand suggestions fortes : clic → filtre "Sans justif." + ouvre drawer sur la 1ere operation sans justificatif
  - Disparait automatiquement quand toutes les operations sont couvertes
  - Utilise le hook existant `useRunAutoRapprochement()` avec invalidation de cache complete

- **Amelioration scoring rapprochement** : meilleure detection des correspondances
  - `score_fournisseur()` : ajout matching par sous-chaine (ex: "amazon" dans "PRLVSEPAAMAZONPAYMENT" → score 1.0)
  - Seuil auto-association abaisse de 0.95 → 0.80 (avec toujours ecart >= 0.02 entre 1er et 2eme match)
  - Niveaux de confiance ajustes : fort >= 0.80, probable >= 0.65, possible >= 0.50
  - Scores reels passes de 0.80 max a 0.93-1.0 grace au substring matching

- **Recherche libre dans le drawer attribution** : recherche dans tous les justificatifs en attente
  - Requete `GET /justificatifs/?status=en_attente&search=...` avec debounce 300ms
  - Resultats affiches sous les suggestions scorees avec separateur "Autres justificatifs correspondants"
  - Chaque resultat a un bouton "Attribuer" orange identique
  - Message d'aide quand aucune suggestion : "Tapez un nom pour rechercher dans tous les justificatifs"

- **Fix affichage score** : `score.total` (0-1 backend) multiplie par 100 pour affichage en pourcentage
  - Corrige le badge qui affichait "1%" au lieu de "80%"
  - `scoreColor()` recoit maintenant correctement la valeur 0-100

- **Bouton Attribuer modernise** : style orange identique au bouton "Associer automatiquement"
  - `bg-warning text-background` avec `shadow-sm`, `hover:scale-105`, `font-semibold`

### Added (2026-04-06) — Session 1
- **Refonte page Justificatifs** : remplacement de la galerie par une vue operations-centree
  - Tableau triable 7 colonnes (date, libelle, debit, credit, categorie, sous-categorie, justif)
  - Hook dedie `useJustificatifsPage` avec enrichissement `_originalIndex` + `_filename`
  - Filtre sans/avec justificatif (defaut: sans), 4 MetricCards (total, avec, sans, taux %)
  - `JustificatifAttributionDrawer` (800px, split resizable avec poignee drag, persistance localStorage)
  - Suggestions scorees avec hover 300ms → preview PDF inline (`<object type="application/pdf">`)
  - Attribution + dissociation + navigation post-attribution (saut a l'op suivante sans justif)
  - Flash highlight CSS sur la ligne active apres navigation
  - Selecteur annee/mois en cascade (pattern EditorPage), sync annee avec donnees disponibles
  - ReconstituerButton en bas du panneau gauche, sandbox SSE badge dans le header

- **Fix preview PDF inline** : `Content-Disposition: inline` dans l'endpoint `/api/justificatifs/{filename}/preview` pour afficher les PDF dans les iframes au lieu de les telecharger

- **Fix EditableCell (EditorPage)** : etat local (`useState`) pour eviter la perte de focus a chaque frappe dans les champs texte (commentaire, libelle). Valeur committee au parent au `onBlur` ou `Enter`

- **Ventilation d'operations** : une operation bancaire peut etre ventilee en N sous-lignes (>=2) avec categorie, sous-categorie, montant et justificatif individuels
  - Backend : modele `VentilationLine`, service `ventilation_service.py`, router `/api/ventilation` (PUT/DELETE/PATCH)
  - `sum(montants)` doit egaler le montant de l'operation (tolerance 0.01)
  - Categorie parente automatiquement mise a "Ventile"
  - Cloture/analytics/alertes iterent sur les sous-lignes individuellement
  - Rapprochement auto et manuel supportent les sous-lignes (`ventilation_index`)
  - Frontend : bouton Scissors dans EditorPage, `VentilationDrawer` (600px) avec barre solde temps reel, `VentilationLines` indentees sous l'op parente
  - Selecteur sous-ligne dans `RapprochementManuelDrawer` et `RapprochementPage`
  - Mode annee complete : sous-lignes visibles, Scissors masque

- **Fix extraction OCR** : refonte complete du parsing des justificatifs
  - Regex montants robuste : capture `1163.08`, `1439.87` (4+ chiffres sans espace)
  - `best_amount` = montant TTC : priorite total facture > ttc > total > euro > max, avec collecte multi-sources et max(candidates)
  - `best_date` = date facture : priorite ligne "date" + mot-cle facture, exclusion echeance/circulation, detection mois en lettres ("18 juillet 2025")
  - `supplier` : fallback formes juridiques (Bank, plc, GmbH, Ltd, SCP, SELARL) + premiere ligne non-vide
  - Recherche multi-ligne (3 lignes apres le mot-cle) pour les PDF ou les valeurs sont sur des lignes separees

- **Convention de nommage justificatifs** : parsing `fournisseur_YYYYMMDD_montant.pdf`
  - `_parse_filename_convention()` : pure function, 3 segments exactement
  - Priorite filename > OCR pour chaque champ individuellement
  - Tracabilite `filename_parsed` et `original_filename` dans le `.ocr.json`
  - Propage dans batch upload et sandbox watchdog
  - Fichiers existants (`justificatif_YYYYMMDD_HHMMSS_*.pdf`) non impactes (4+ segments → null)

- **Edition manuelle des donnees OCR** : correction des valeurs extraites depuis le frontend
  - Endpoint `PATCH /api/ocr/{filename}/extracted-data` avec modele `OcrManualEdit`
  - Composant `OcrDataEditor` : chips cliquables montants (EUR) + dates (DD/MM/YYYY), input manuel, badge Manuel/OCR
  - Badge "OCR incomplet" (ambre) dans la galerie justificatifs quand `ocr_amount` ou `ocr_date` sont null
  - Integration dans le drawer justificatif (sous le PDF preview)
  - Invalidation TanStack Query sur ocr, justificatifs, rapprochement

- **ML Monitoring** : systeme complet de monitoring de l'agent IA
  - Logging automatique des predictions a chaque categorisation (source, confiance, risque hallucination)
  - Tracking des corrections manuelles au save dans l'editeur (detection par comparaison avec derniere prediction)
  - Logging des entrainements (accuracy, nb exemples, nb regles)
  - Nouvel onglet "Monitoring" dans la page Agent IA avec 4 sections :
    - Performance : taux de couverture, confiance moyenne, distribution confiance
    - Fiabilite : taux de correction, taux d'hallucination, libelles inconnus, table top erreurs
    - Progression : courbe accuracy (LineChart Recharts), courbe taux correction/mois, base de connaissances
    - Diagnostic : paires confuses (matrice confusion simplifiee), categories orphelines
  - Carte KPI "Agent IA" dans le Dashboard : couverture, corrections, trend, alerte, clic → Agent IA
  - `backend/models/ml.py` : PredictionSource enum, PredictionLog, PredictionBatchLog, CorrectionLog, TrainingLog, MLMonitoringStats, MLHealthKPI
  - `backend/services/ml_monitoring_service.py` : logging, detection corrections, stats agregees, health KPI
  - 4 endpoints monitoring : `GET /api/ml/monitoring/stats`, `/health`, `/confusion`, `/correction-history`
  - Stockage logs dans `data/ml/logs/predictions/` et `data/ml/logs/corrections/`
  - Systeme d'onglets dans AgentIAPage (Dashboard ML | Monitoring)

- **Entrainer + Appliquer** : bouton bulk recategorisation dans Agent IA
  - Bouton vert "Entrainer + Appliquer" dans la page Agent IA (section Actions rapides)
  - En un clic : entraine le modele sklearn puis recategorise (mode empty_only) toutes les operations de l'annee
  - Checkbox "Toutes les annees" pour traiter tous les fichiers
  - `POST /api/ml/train-and-apply?year=` : endpoint combine entrainement + categorisation bulk
  - Toast avec stats concretes (nb fichiers traites, nb operations modifiees)
  - Utilise `useFiscalYearStore` pour l'annee par defaut
  - Extraction de `categorize_file()` dans `operation_service.py` (logique deplacee du router vers le service)

- **Badge Agent IA sidebar** : badge violet dans la sidebar quand l'agent IA necessite attention
  - Affiche le nombre d'operations non categorisees
  - Visible uniquement si operations non categorisees > 0 ET dernier entrainement > 7 jours

### Added (2026-04-05)
- **Module Tâches Kanban** : suivi des actions comptables avec vue kanban 3 colonnes
  - 3 colonnes : To do / In progress / Done avec drag & drop via @dnd-kit
  - Tâches auto-générées par scan de l'état applicatif (5 détections) : opérations non catégorisées, justificatifs en attente, clôture incomplète, mois sans relevé, alertes non résolues
  - Tâches manuelles créées par l'utilisateur avec titre, description, priorité, date d'échéance
  - Scopé par année (synchronisé avec le sélecteur année global de la sidebar)
  - Déduplication des tâches auto par `auto_key` : ne recrée pas les tâches done/dismissed, met à jour les tâches actives
  - Badge "Auto" sur les tâches générées, bouton Dismiss (EyeOff) pour ignorer
  - Formulaire inline pour création/édition, validation Enter/Escape
  - Refresh automatique au montage de la page et au changement d'année
  - Badge compteur de tâches actives dans la sidebar (amber)
  - `backend/models/task.py` : 3 enums (TaskStatus, TaskPriority, TaskSource) + 3 modèles Pydantic
  - `backend/services/task_service.py` : `generate_auto_tasks(year)` avec 5 détections scopées par année
  - `backend/routers/tasks.py` : 5 endpoints CRUD + refresh sous `/api/tasks`
  - `frontend/src/hooks/useTasks.ts` : 5 hooks TanStack Query
  - 4 composants dans `frontend/src/components/tasks/` (TaskCard, KanbanColumn, TaskInlineForm, TasksPage)
  - Données dans `data/tasks.json`
  - Sidebar : entrée "Tâches" avec icône CheckSquare dans le groupe OUTILS

- **Sélecteur Année Global** : store Zustand partagé entre toutes les pages
  - `frontend/src/stores/useFiscalYearStore.ts` : store Zustand avec middleware `persist` (localStorage `neuronx-fiscal-year`)
  - Sélecteur `◀ ANNÉE ▶` compact dans la sidebar, au-dessus des groupes de navigation
  - Synchronisation bidirectionnelle : changer l'année dans la sidebar ou sur une page met à jour partout
  - Pages migrées : EditorPage, AlertesPage, CloturePage, ComptaAnalytiquePage, DashboardPage, ExportPage, ReportsPage, PrevisionnelPage
  - L'année persiste au refresh navigateur
  - Le mois/trimestre restent en `useState` local par page (non concernés)

### Fixed (2026-04-05)
- **Catégorisation REMPLA** : les opérations bancaires contenant "REMPLA" dans le libellé (virements SEPA remplaçants) sont désormais catégorisées automatiquement en "Remplaçant / Honoraires"
  - `_categorize_simple()` : ajout "Remplaçant" avec keywords ["REMPLA", "REMPLACANT", "REMPLACEMENT"] **avant** "Revenus" (qui matchait "VIREMENT" en premier)
  - `predict_category()` : ajout substring matching dans le scoring keywords (ex: "motifremplacementdr" matche "rempla")
  - `predict_subcategory()` : ajout fallback `subcategory_patterns` pour mapper REMPLA → Honoraires
  - `model.json` : ajout keywords Remplaçant + subcategory_patterns
  - 19 opérations existantes (2024-2026) recatégorisées en "Remplaçant / Honoraires"

### Added (2026-04-05)
- **Module Prévisionnel** : calendrier de trésorerie annuel remplaçant l'ancien Échéancier
  - Timeline 12 mois avec barres empilées Recharts (charges rouge / recettes vert), courbe trésorerie cumulée togglable
  - 3 sources de données : providers récurrents, moyennes N-1 par catégorie, régression linéaire + saisonnalité
  - 2 modes fournisseurs : facture récurrente (1 document par période) et échéancier de prélèvements (parsing OCR 3 formats)
  - CRUD providers avec drawer 600px, keywords OCR/opérations, périodicité configurable
  - Grille 12 mois prélèvements avec statuts colorés (vérifié/écart/attendu), confiance OCR
  - Scan automatique documents (OCR+GED → échéances, score ≥0.75), chaînage mode échéancier (association → parse OCR → populate → scan opérations)
  - Scan prélèvements vs opérations bancaires par keywords + montant ± tolérance
  - Expansion inline au clic sur barre : détail charges/recettes avec source et statut
  - Paramètres : seuil montant, grille checkboxes catégories à inclure, catégories recettes (chips), overrides mensuels
  - Background scan asyncio toutes les heures (refresh + statuts retard + scan documents + scan prélèvements)
  - Intégrations post-OCR/sandbox/GED (`check_single_document` en try/except)
  - `backend/services/previsionnel_service.py` : CRUD, timeline, parsing OCR, scan matching, régression numpy
  - `backend/routers/previsionnel.py` : 18 endpoints sous `/api/previsionnel`
  - `frontend/src/hooks/usePrevisionnel.ts` : 20 hooks TanStack Query
  - 11 composants dans `frontend/src/components/previsionnel/`
  - Données dans `data/previsionnel/` (providers.json, echeances.json, settings.json)
  - Sidebar : entrée "Prévisionnel" dans le groupe ANALYSE (remplace Échéancier du groupe TRAITEMENT)
- **Templates Justificatifs** : système de templates par fournisseur pour reconstituer des justificatifs manquants
  - Création de templates depuis des justificatifs scannés (extraction OCR enrichie via Qwen2-VL, fallback données OCR basiques)
  - Bibliothèque fournisseurs avec aliases de matching (détection automatique dans les libellés bancaires)
  - Génération de PDF reconstitués via ReportLab (format A5, professionnel, sans watermark)
  - Traçabilité exclusivement dans les métadonnées : préfixe `reconstitue_` + champ `"source": "reconstitue"` dans `.ocr.json`
  - Champs auto-remplis (opération, OCR), manuels, fixes et calculés (TVA temps réel via formules)
  - Auto-association optionnelle du justificatif généré à l'opération source
  - 4ème onglet "Templates justificatifs" dans la page OCR (création, bibliothèque, génération)
  - Bouton `ReconstituerButton` intégré dans 4 pages : Rapprochement (drawer vide), Alertes (justificatif_manquant), Éditeur (colonne trombone), Clôture (mois incomplets)
  - `ReconstituerDrawer` : drawer 600px avec formulaire pré-rempli, sélection template, champs auto/manuels
  - `backend/services/template_service.py` : CRUD, extraction OCR, suggestion, génération PDF, auto-association
  - `backend/routers/templates.py` : 8 endpoints sous `/api/templates`
  - `frontend/src/hooks/useTemplates.ts` : 7 hooks (3 queries + 4 mutations)
  - Templates stockés dans `data/templates/justificatifs_templates.json`
  - Fichiers générés dans `data/justificatifs/en_attente/` (reconstitue_YYYYMMDD_HHMMSS_vendor.pdf + .ocr.json)
- **Pipeline Comptable Interactif** : nouvelle page d'accueil (`/`) remplace le Dashboard
  - Stepper vertical 6 étapes avec statuts temps réel (Import, Catégorisation, Justificatifs, Rapprochement, Vérification, Clôture)
  - Grille 12 badges mois cliquables avec icône statut, nom court et % progression (couleur vert/ambre/gris)
  - Sélecteur d'exercice fiscal avec boutons années (style primary pour l'année active)
  - Barre de progression globale pondérée (10/20/25/25/10/10)
  - Cards expandables accordion avec métriques, description et boutons d'action vers les pages concernées
  - Persistance année/mois dans localStorage
  - Badge % global dans la sidebar sous l'item Pipeline
  - Dashboard déplacé vers `/dashboard` dans le groupe ANALYSE
  - Suppression du drawer Pipeline flottant (PipelineWrapper, PipelineTrigger, PipelineDrawer, PipelineStep, PipelineDetail)
  - `frontend/src/hooks/usePipeline.ts` : réécrit avec 6 étapes, monthBadges, localStorage
  - `frontend/src/components/pipeline/PipelinePage.tsx` + `PipelineStepCard.tsx` : nouveaux composants
  - Types : `PipelineStepStatus`, `PipelineStep`, `PipelineMetric`, `PipelineState`

### Added (2026-04-05 — previous)
- **Simulation BNC** : simulateur fiscal complet pour optimisation des charges
  - Page `/simulation` avec 2 onglets (Optimisation, Prévisions)
  - Moteur fiscal dual Python (`fiscal_service.py`) + TypeScript (`fiscal-engine.ts`) avec résultats identiques
  - Barèmes versionnés JSON dans `data/baremes/` (URSSAF, CARMF, IR, ODM) avec fallback année la plus récente
  - Onglet Optimisation : leviers interactifs (Madelin, PER, CARMF classe, investissement, remplacement, formation DPC), expander dépenses détaillées par catégorie (véhicule, fournitures, abonnements, télécom, logiciel, comptable, frais bancaires, repas, poste, autres)
  - Distinction critique PER (réduit IR seul) vs Madelin (réduit BNC social + IR)
  - Impact charges temps réel (URSSAF, CARMF, ODM, IR) avec delta et badges économie
  - Taux marginal réel combiné avec barre segmentée colorée (IR/URSSAF/CARMF)
  - Comparatif charge immédiate vs immobilisation pour les investissements
  - Projection des dotations sur 5 ans (graphique Recharts)
  - Onglet Prévisions : historique BNC depuis les opérations, projections saisonnières, profil saisonnier 12 mois, tableau annuel avec évolution
  - Parts fiscales : défaut 1.75 (parent isolé + garde alternée), options 1/1.25/1.5/1.75/2/2.5/3/3.5/4
  - 8 endpoints sous `/api/simulation` (barèmes, calculate, taux-marginal, seuils, historique, prévisions)
  - `frontend/src/hooks/useSimulation.ts` : 7 hooks (5 queries + 2 mutations)
  - Sidebar : entrée "Simulation BNC" avec icône Calculator dans le groupe ANALYSE
- **Module Amortissements** : registre des immobilisations, calcul dotations linéaire/dégressif avec pro rata temporis, détection auto candidates (montant > 500€ + catégorie éligible), plafonds véhicules CO2 (4 classes), gestion cessions avec calcul plus/moins-value et régime fiscal (court/long terme), moteur de calcul dupliqué Python/TypeScript
  - Page `/amortissements` avec 4 onglets (Registre, Tableau annuel, Synthèse par poste, Candidates)
  - 3 drawers : ImmobilisationDrawer (650px, aperçu tableau temps réel), ConfigAmortissementsDrawer (500px), CessionDrawer (500px)
  - `backend/services/amortissement_service.py` : CRUD, moteur calcul, détection, cession, KPIs
  - `backend/routers/amortissements.py` : 15 endpoints sous `/api/amortissements`
  - `frontend/src/lib/amortissement-engine.ts` : moteur TS identique au Python
  - `frontend/src/hooks/useAmortissements.ts` : 14 hooks (7 queries + 7 mutations)
- **Rapports V2** : refonte complète du module rapports
  - Index JSON (`reports_index.json`) avec réconciliation au boot
  - 3 templates prédéfinis (BNC annuel, Ventilation charges, Récapitulatif social)
  - Format EUR (`1 234,56 €`) dans les PDF, CSV séparateur `;` + virgule décimale, Excel formules SUM
  - Déduplication à la génération (même filtres+format = remplacement)
  - Bibliothèque avec triple vue arbre (par année / par catégorie / par format)
  - Rapports favoris (étoile, tri en premier)
  - Comparaison de 2 rapports (drawer delta montants/ops/%)
  - Rappels dans le dashboard (rapports mensuels/trimestriels non générés)
  - Preview drawer 800px avec édition titre/description inline
  - 12 endpoints sous `/api/reports`
- **Dashboard V2 — Cockpit exercice comptable** : refonte complète de la page d'accueil
  - Sélecteur année + actions rapides (Importer, OCR, Rapprocher)
  - Jauge segmentée 6 critères (relevés/catégorisation/lettrage/justificatifs/rapprochement/exports)
  - 4 cartes KPI avec sparkline BNC mensuel et delta N-1
  - Grille 12 mois cliquables avec 6 badges d'état + expansion (montants + actions contextuelles)
  - Alertes pondérées triées par impact (100=relevé manquant, 80=export, 55+=justificatifs, 40=catégorisation, 25=lettrage)
  - Échéances fiscales (URSSAF/CARMF/ODM) avec countdown J-XX
  - Bar chart recettes vs dépenses (Recharts)
  - Feed activité récente avec timestamps relatifs
  - `GET /api/analytics/year-overview` : endpoint agrégé unique
- **GED — Type libre + OCR auto** : champ type remplacé par autocomplétion libre (datalist HTML), OCR automatique à l'upload via `extract_or_cached()`, preview conditionnel image/PDF
- **GED — Catégorie/sous-catégorie** : ajout sélecteurs catégorie → sous-catégorie en cascade dans l'upload et le drawer metadata (en plus du poste comptable existant)
- **Module GED (Bibliothèque Documents)** : indexation documents existants sans duplication, upload documents libres, postes comptables avec % déductibilité (slider 0-100), thumbnails PDF, double vue arbre (par année / par type), drawer redimensionnable (400-1200px), recherche full-text, ouverture native macOS

### Added (2026-04-04)
- **Compta Analytique — Comparatif recettes/depenses** : separation automatique des categories en 2 groupes (recettes si credit > debit, depenses sinon), 2 graphiques cote a cote, 2 tableaux avec colonnes adaptees (Credit A/B ou Debit A/B), delta badges inverses pour revenus, legendes dynamiques avec periodes selectionnees
- **Compta Analytique — Clic categorie en mode Comparatif** : clic sur une categorie ouvre le CategoryDetailDrawer (sous-categories, evolution mensuelle, operations) — desormais connecte au comparatif en plus du mode Analyse
- **EditorPage — Vue annee complete** : option "Toute l'annee (N ops)" dans le selecteur mois, charge tous les fichiers en parallele via `useYearOperations` (hook `useQueries`), mode lecture seule avec badge ambre, filtres et tri fonctionnels, export CSV disponible
- **EditorPage — Filtre sous-categorie** : dropdown sous-categorie dependant de la categorie selectionnee dans le panel Filtres, reset auto au changement de categorie, grille 5 colonnes
- **useYearOperations hook** : nouveau hook dans `useOperations.ts` utilisant `useQueries` pour charger N fichiers en parallele avec fusion et champ `_sourceFile`
- **Type Operation** : ajout champ optionnel `_sourceFile` pour identifier le fichier source en mode annee complete

### Added (previous)
- **Rapprochement Manuel Drawer** : drawer 800px avec filtres (montant, date, fournisseur), liste scoree, preview PDF iframe
  - `GET /api/rapprochement/{filename}/{index}/suggestions` : suggestions filtrees avec scoring simplifie
  - `frontend/src/hooks/useRapprochementManuel.ts` : hook dedie avec filtres reactifs
  - `frontend/src/components/rapprochement/RapprochementManuelDrawer.tsx` : composant drawer complet
- **Sidebar reorganisee par pipeline comptable** : 5 groupes (Saisie, Traitement, Analyse, Cloture, Outils) avec labels de section discrets
  - Fusion Accueil + Tableau de bord : route `/` affiche DashboardPage directement
  - Suppression de la page Accueil separee
- **OCR = point d'entree unique justificatifs** :
  - `POST /api/ocr/batch-upload` : upload multi-fichiers + OCR synchrone + sauvegarde en_attente
  - Nouveau tab "Upload & OCR" (defaut) dans OcrPage avec drag & drop batch jusqu'a 50 fichiers
  - Page Justificatifs : upload retire, remplace par bouton "Ajouter via OCR"
- **Compta Analytique — Filtres globaux** : filtre annee/trimestre/mois en haut de page, applique a toutes les sections (KPIs, ventilation, tendances, anomalies)
  - Tous les endpoints analytics acceptent `quarter` et `month` en plus de `year`
- **Compta Analytique — Drill-down categorie** :
  - `GET /api/analytics/category-detail` : sous-categories, evolution mensuelle, 50 dernieres operations
  - `CategoryDetailDrawer.tsx` : drawer 700px avec barres sous-categories, mini BarChart, liste operations
  - Categories cliquables dans le tableau de ventilation
- **Compta Analytique — Comparatif periodes** :
  - `GET /api/analytics/compare` : compare 2 periodes avec KPIs + deltas % + ventilation par categorie
  - Onglet "Comparatif" dans la page avec 2 selecteurs periode, KPIs cote a cote, graphe barres groupees, tableau detaille
- **Compta Analytique — Barres empilees** : 3eme mode "Empile" dans la section Evolution temporelle (barres empilees par categorie par mois/trimestre)
- **Sandbox Watchdog OCR** : depot automatique de PDF dans `data/justificatifs/sandbox/` avec traitement OCR et deplacement vers `en_attente/`
  - `backend/services/sandbox_service.py` : watchdog (lib `watchdog`), gestion doublons, scan initial au demarrage
  - `backend/routers/sandbox.py` : SSE `/api/sandbox/events`, `GET /list`, `DELETE /{filename}`
  - `frontend/src/hooks/useSandbox.ts` : hook EventSource avec reconnexion auto
  - Badge inline "Sandbox actif" sur la page Justificatifs
  - Notifications toast via `react-hot-toast` (global `<Toaster />` dans App.tsx)
- Lifespan FastAPI pour gestion du cycle de vie du watchdog (start/stop)

### Changed
- `frontend/src/App.tsx` : route `/` = PipelinePage, route `/dashboard` = DashboardPage (18 routes)
- `frontend/src/components/layout/Sidebar.tsx` : item Pipeline hors-groupe en tête avec badge % global, Dashboard déplacé vers `/dashboard` dans ANALYSE
- `frontend/src/components/layout/AppLayout.tsx` : suppression PipelineWrapper (drawer flottant)
- `backend/core/config.py` : ajout `JUSTIFICATIFS_SANDBOX_DIR` + `ensure_directories()`
- `backend/main.py` : ajout lifespan context manager, import router sandbox
- `frontend/src/hooks/useApi.ts` : tous les hooks analytics acceptent year/quarter/month
- `frontend/src/components/ocr/OcrPage.tsx` : 4 onglets (Upload & OCR, Test Manuel, Historique, Templates justificatifs)
- `frontend/src/components/justificatifs/JustificatifsPage.tsx` : zone upload retiree
- `frontend/src/components/compta-analytique/ComptaAnalytiquePage.tsx` : filtres globaux, drill-down, toggle Analyse/Comparatif, mode empile

### Dependencies
- Backend : `watchdog>=4.0.0`
- Frontend : `react-hot-toast`

---

## [3.0.2] - 2025-05-20

### Added
- Module **Rapprochement bancaire** : auto/manuel, scoring (date + montant + fournisseur OCR)
- Module **Lettrage comptable** : toggle/bulk, statistiques par fichier
- Module **Cloture** : calendrier annuel, statut par mois (complet/partiel/manquant)

---

## [3.0.1] - 2025-05-20

### Added
- Donnees de configuration initiales
- Categories et sous-categories par defaut
- Fichiers d'entrainement ML

---

## [3.0.0] - 2025-05-20

### Added
- Migration complete de Streamlit (V2) vers React 19 + FastAPI
- 15 pages fonctionnelles sans placeholders
- Pipeline OCR EasyOCR avec cache `.ocr.json`
- Categorisation IA (regles + scikit-learn)
- Import PDF avec detection doublons
- Export comptable mensuel (ZIP)
- Systeme de rapports (CSV/PDF/Excel)
- Requetes analytiques personnalisees
- Gestion des justificatifs (upload, association, preview)
- Dark theme avec CSS variables
- TanStack Query pour la gestion d'etat serveur
