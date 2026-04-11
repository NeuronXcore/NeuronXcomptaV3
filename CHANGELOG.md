# Changelog

Toutes les modifications notables de NeuronXcompta sont documentees ici.

Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [Unreleased]

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
