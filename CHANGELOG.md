# Changelog

Toutes les modifications notables de NeuronXcompta sont documentees ici.

Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [Unreleased]

### Fixed (2026-04-29) — Bouton « Envoyer au comptable » : factures d'achat enfin jointes au ZIP

**Bug observé** : depuis le bouton « Envoyer au comptable » du header `AmortissementsPage`, les rapports `amortissements_registre` + `amortissements_dotations` étaient bien joints, mais le **sous-dossier `Justificatifs_immobilisations/` du ZIP restait vide** alors que les immos avaient des justifs liés. Implémentation Session 35 cassée silencieusement par un mismatch de filtre.

**Cause racine** : dans [`backend/services/report_service.py`](backend/services/report_service.py), `_compute_linked_justifs(template_id, filters, year)` passait directement `filters.get("statut")` et `filters.get("poste")` (valeurs frontend par défaut = `"all"`) à `amortissement_service.list_immobilisations_with_source(statut="all", ...)`. Le backend filtrait STRICTEMENT `i.get("statut") == "all"` → 0 immo réelle (vrais statuts : `en_cours`, `amorti`, `sorti`). Résultat : `linked_justifs = []` figé dans `rapport_meta` à la génération.

**Stratégie de fix** — triple niveau pour couvrir rapports nouveaux, legacy, et UX en avance.

- **Niveau 1 — Fix `compute_linked_justifs` (rapports nouveaux)**
  - **[`backend/services/report_service.py`](backend/services/report_service.py)** — la fonction est désormais publique (`compute_linked_justifs` sans underscore, alias backward-compat `_compute_linked_justifs` conservé). Conversion `"all"|"" → None` pour `statut` et `poste`. Le param `year` n'est plus propagé à `list_immobilisations_with_source` (qui filtre par `date_acquisition`, pas par exercice de dotation) — pour `amortissements_dotations` la restriction « dotations > 0 » est appliquée séparément après.
  - Effet : tout NOUVEAU rapport amortissements généré aura `linked_justifs` correctement peuplé. Vérifié end-to-end : `compute_linked_justifs('amortissements_registre', {'year': 2026, 'statut': 'all', 'poste': 'all'}, 2026)` → `['boulanger_20260127_4506.99.pdf', 'amazon_20250626_789.60.pdf']` (vs `[]` avant fix).

- **Niveau 2 — Fallback dynamique côté envoi (rapports legacy)**
  - **[`backend/services/email_service.py`](backend/services/email_service.py)** — `_collect_linked_justifs(documents)` enrichi : pour chaque rapport amortissements présent, lit d'abord `rapport_meta.linked_justifs` (comportement actuel) ; **si la liste est vide MAIS** que le rapport est amortissements, **recalcule à la volée** via `report_service.compute_linked_justifs(template_id, rapport_filters, year)`. Logge en `info` quand le fallback se déclenche. Couvre les rapports legacy (générés avant le fix Session 35.1) et fait office de filet de sécurité même si une régénération frontend échoue.
  - Vérifié sur 3 rapports legacy `data/ged/ged_metadata.json` 2025 (tous avec `linked_justifs=None`) : le fallback résout bien les 2 justifs `boulanger_*` + `amazon_*`. Constante `_AMORT_TEMPLATES = ("amortissements_registre", "amortissements_dotations")` exportée.

- **Niveau 3 — Régénération opportuniste frontend**
  - **[`frontend/src/hooks/useAmortissements.ts`](frontend/src/hooks/useAmortissements.ts)** — `usePrepareAmortissementsEnvoi(year)` étendu : avant la phase auto-génération des rapports manquants, vérifie si au moins une immo de l'année a `has_justif=true`. Si c'est le cas, force la régénération des rapports existants dont `linked_justifs.length === 0` (snapshot stale). Cela rafraîchit la metadata GED avec les linked_justifs corrects via le Niveau 1, et le ZIP final est cohérent. Le fallback Niveau 2 reste un filet de sécurité au cas où la régénération tombe en cache (faut-il ?).

- **Pas d'impact non-régression**
  - Sélection sans rapport amortissements → `_collect_linked_justifs` retourne `set()` vide (early-return `if not has_rapport`).
  - Sélection avec rapport BNC ou autre template → pas de fallback déclenché (templates filtrés via `_AMORT_TEMPLATES`).
  - Justif coché manuellement ET listé en linked → toujours dédupliqué dans `Justificatifs_immobilisations/` (priorité au sous-dossier dédié, comportement Session 35 inchangé).

- **Vérification end-to-end**
  - Backend pipeline (génération → metadata → envoi) : régénération `amortissements_registre` 2026 → metadata GED `linked_justifs: ['boulanger_*', 'amazon_*']` → `_collect_linked_justifs` retourne 2 justifs. Pipeline cohérent.
  - Fallback dynamique : rapport legacy 2025 avec `linked_justifs=None` figé → `_collect_linked_justifs` recalcule et retourne 2 justifs sans toucher la metadata.
  - Régression : sélection vide ou sans rapport amortissements → 0 justif retourné.

### Fixed (2026-04-29) — Bug VNC actuelle + statut « amorti » prématuré sur les immos pluriannuelles

Bug structurel découvert pendant la session annotation justif : une immo récente avec `durée=3 ans` apparaissait comme `amorti` (avancement 100%, VNC 0 €) **dès sa création**, alors que les premières dotations n'avaient pas encore été passées. Cause : `cumul = sum(tableau)` sommait toutes les lignes du tableau (passées ET futures), donnant l'illusion d'une immobilisation totalement amortie. Affectait 4 chemins (registre, détail, KPIs, statut auto).

- **Helper backend `_compute_realized_state(tableau, base, anterieurs, today?)`**
  - **[`backend/services/amortissement_service.py`](backend/services/amortissement_service.py:240)** — nouveau helper unique qui calcule le cumul réalisé au jour courant : (1) somme des dotations des exercices `< current_year` complets, (2) **pro-rata temporis** sur l'exercice courant via `(month-1) × 30 + (day-1) / jours_ligne` (base 360, convention comptable française) ramené à `[0, 1]`, (3) ajoute `amortissements_anterieurs` pour les immos en reprise. Retourne `{cumul_realise, vnc_actuelle, avancement_pct, amorti_realise}`. `amorti_realise=True` ssi la dernière ligne du tableau est dans le passé ET sa VNC finale est ≤ 0,01 €. `today` est paramétrable (default `date.today()`) pour tests deterministes.

- **4 callers fixés (1 helper, 4 sites d'appel)**
  - **`get_all_immobilisations()`** — alimentait le registre du frontend avec `vnc_actuelle = base - sum(tous_les_exercices)` → 0 €. Désormais consomme `_compute_realized_state` → VNC réelle au jour J.
  - **`get_immobilisation(immo_id)`** — même bug dans le détail (drawer édition + tableau).
  - **`update_immobilisation()`** — auto-update statut basé sur `tableau[-1].vnc <= 0` (qui est toujours vrai en fin de tableau pluriannuel) → toute mutation d'une immo bien constituée la basculait à `amorti` au save. Désormais utilise `state["amorti_realise"]` qui exige que **tous les exercices du tableau soient dans le passé** ET que la VNC finale soit nulle. Préserve `statut="sorti"` (cession).
  - **`get_kpis()`** — `total_vnc` sous-évalué (= sum bases × 0 sur les immos pluriannuelles), ventilation par poste idem. Désormais consomme `_compute_realized_state` par immo active.

- **Vérifié sur le corpus user**
  - **Avant fix** : LDLC 2599,99 € (acquis 2025-02-15, durée 3 ans) → avancement **100%** / VNC **0 €** / statut **amorti** (alors que dotations restantes : 2026 = 866,66 €, 2027 = 866,66 €, 2028 = 96,30 €). Boulanger 4506,99 € → 100% / 0 € / amorti idem. Amazon 789,60 € → idem.
  - **Après fix** (au 2026-04-29) : Boulanger (acquis 2026-01-28) → avancement **11%** / VNC **4 014,56 €** / statut **en_cours**. Amazon (acquis 2025-06-26) → avancement **28%** / VNC **565,15 €** / statut **en_cours**. Total VNC du registre : **4 579,71 €** (cohérent avec les bases - dotations passées + pro-rata 2026 partiel).
  - Calculs vérifiés : Boulanger 4506,99 € sur 3 ans = 1 502,33 €/an. Acquis 28/01/2026 → ~3 mois consommés sur 36 (base 360). `cumul = 0 (pas d'exercice passé) + 1502,33 × (3×30/360) = 375,58 €`. VNC = 4 506,99 - 375,58 ≈ 4 131 €. (L'écart avec 4 014,56 € vient du pro-rata année 1 réduit de 28 jours au lieu de plein mois — convention `jours = 11×30 + 2 = 332` pour 2026 vs 360.)

- **Conséquences UI**
  - Registre Amortissements : VNC + avancement + statut désormais corrects.
  - Drawer édition : tableau d'amortissement inchangé (déjà correct), mais carte récap au-dessus reflète l'état réalisé.
  - Compta Analytique > drawer Dotations : `vnc_actuelle` consommé est désormais réaliste.
  - Bouton « Envoyer au comptable » : pas d'impact (le rapport `amortissements_registre` consomme `list_immobilisations_with_source` qui passe par `get_all_immobilisations`, donc bénéficie automatiquement du fix).

- **Pas de migration** — aucune donnée corrompue sur disque (le fichier `data/amortissements/immobilisations.json` ne stocke que `statut="en_cours"` ; `update_immobilisation` ne le faisait basculer à `amorti` qu'au moment du save d'une mutation. Sur le corpus user actuel, aucun statut n'était persisté à `amorti` au moment du fix). Si une mutation passée a corrompu un statut, le prochain save propre le corrige automatiquement (logique réécrite).

### Added (2026-04-29) — Annotation immobilisation inline + visualisation justif (paperclip + sub-drawer + lightbox) + section source en mode édition

UX boost sur la page Amortissements : la `designation` est désormais éditable directement dans le registre (hover crayon ou double-clic), une nouvelle colonne paperclip ouvre le justif lié sans passer par le drawer, et la section « Opération source & justificatif » qui n'existait qu'en mode candidate est étendue au mode édition (parité). Le `JustifPreviewLightbox` (déjà utilisé par `PendingScansWidget`) est extrait vers `components/shared/` pour réutilisation. Le `PreviewSubDrawer` gagne un mode `standalone` (sans drawer parent) et un bouton « Voir en plein écran » qui chaîne vers la lightbox.

- **Backend — sérialiseur enrichi + route `/source`**
  - **[`backend/routers/amortissements.py`](backend/routers/amortissements.py)** — `GET /api/amortissements/` utilise désormais `list_immobilisations_with_source` (au lieu de `get_all_immobilisations`) → expose `has_justif: bool` + `justif_filename: Optional[str]` directement sur chaque ligne du registre, évite le N+1 côté frontend pour la cellule paperclip. Nouvelle route `GET /api/amortissements/{immo_id}/source` déclarée **AVANT** `/{immo_id}` (ordre FastAPI critique — sinon `/source` serait capturé comme un `immo_id`) qui retourne `{operation_file, operation_index, libelle, date, debit, credit, categorie, sous_categorie, justif_filename}` ou `null`. Délègue à `amortissement_service.get_linked_op_with_justif(immo_id)` (helper existant introduit en Session 35).

- **Frontend — types + helper utilitaire**
  - **[`frontend/src/types/index.ts`](frontend/src/types/index.ts)** — nouveau type `ImmobilisationSource` (op + justif lié via transitivité) + extension `Immobilisation` avec `has_justif?: boolean` + `justif_filename?: string | null` (champs runtime peuplés par `list_immobilisations_with_source`).
  - **[`frontend/src/lib/utils.ts`](frontend/src/lib/utils.ts)** — helper `isLibelleBrut(designation)` détecte les libellés bancaires bruts (vide / longueur > 80 / commence par `PRLV|CB |VIR|SEPA|RETRAIT|CHQ|PAIEMENT`). Utilisé pour styler en italique gris dans le registre et afficher une incitation à renommer dans le drawer.

- **Frontend — hook + invalidations**
  - **[`frontend/src/hooks/useAmortissements.ts`](frontend/src/hooks/useAmortissements.ts)** — nouveau hook `useImmobilisationSource(immoId)` (queryKey `['amortissements', 'source', immoId]`, staleTime 30s, `enabled: !!immoId`). Mutations `useCreateImmobilisation` / `useUpdateImmobilisation` / `useDeleteImmobilisation` / `useImmobiliserCandidate` invalident désormais aussi `['amortissements', 'source']` pour propager les changements de transitivité op → justif. **Fix bonus** : `useImmobilisations()` générait `/api/amortissements?` (sans trailing slash) sans param qui plantait le proxy Vite preview avec `Failed to fetch` → désormais `/amortissements/` ou `/amortissements/?p=x` (URL toujours valide).

- **Frontend — `JustifPreviewLightbox` partagé**
  - **[`frontend/src/components/shared/JustifPreviewLightbox.tsx`](frontend/src/components/shared/JustifPreviewLightbox.tsx)** *(nouveau)* — extrait depuis `PendingScansWidget` pour réutilisation. API publique `{filename: string | null, onClose, onOpenExternal?}`. Modal z-60 backdrop noir 80% + blur, card centrale `90vw × 90vh max 1100px`, clic backdrop = close, Esc en mode capture (`stopPropagation` pour ne pas remonter au drawer parent). Bouton External Link `target="_blank"` vers `/api/justificatifs/{name}/preview` (sur macOS, ouverture native via le navigateur). `filename === null` = composant ne rend rien (pattern aligné avec `PreviewSubDrawer`).
  - **[`frontend/src/components/pipeline/PendingScansWidget.tsx`](frontend/src/components/pipeline/PendingScansWidget.tsx)** — recâblé sur le composant partagé (suppression de la définition locale, import depuis `components/shared/`).

- **Frontend — `PreviewSubDrawer` enrichi**
  - **[`frontend/src/components/ocr/PreviewSubDrawer.tsx`](frontend/src/components/ocr/PreviewSubDrawer.tsx)** — 2 nouvelles props : `standalone?: boolean` (ancre `right-0` au lieu de `right-{mainDrawerWidth}px` + backdrop `bg-black/55 backdrop-blur-sm` propre quand pas de drawer principal — utilisé par la cellule paperclip du registre) et `onOpenLightbox?: () => void` (bouton `Maximize2` dans le header qui passe la main à un `JustifPreviewLightbox` géré par le parent). Z-index par défaut bumpé à 50 en mode standalone (vs 40 en mode with-main).

- **Frontend — `RegistreTab` refondu (édition inline + colonne paperclip)**
  - **[`frontend/src/components/amortissements/AmortissementsPage.tsx`](frontend/src/components/amortissements/AmortissementsPage.tsx)** — édition inline `designation` : state local `editingId` + `editValue`, `<input autoFocus>` au double-clic ou clic crayon (`Pencil` hover-only via `opacity-0 group-hover:opacity-100`), Enter commit / Esc cancel / blur commit, dédup `value === current` skip API call. Pavé décoratif `Package` 30×30 violet (`bg-primary/10 text-primary`) à gauche de la désignation. Style **italique gris** quand `isLibelleBrut(designation)` true. **Nouvelle colonne « Justif. »** (60px, après VNC) : si `has_justif`, paperclip vert sur `bg-emerald-500/15` cliquable qui ouvre `PreviewSubDrawer standalone width=700` ; le bouton `Maximize2` dans le header du sub-drawer chaîne vers `JustifPreviewLightbox`. Si pas de justif, paperclip muted barré (trait CSS `rotate(-25deg)` absolu) avec toast info au clic. Click sur le `<tr>` (hors cellules édition/paperclip) ouvre toujours le drawer édition comme avant.

- **Frontend — `ImmobilisationDrawer` section source en mode édition + lightbulb**
  - **[`frontend/src/components/amortissements/ImmobilisationDrawer.tsx`](frontend/src/components/amortissements/ImmobilisationDrawer.tsx)** — parité avec mode candidate : nouvelle branche `isEdit && !isCandidate` qui consomme `useImmobilisationSource(immo.id)` et affiche soit un bandeau bleu info « Aucune opération source rattachée (immobilisation créée manuellement ou en reprise) » si `source === null`, soit la même UI que le mode candidate (carte op readonly + bouton `Voir dans l'éditeur ↗` + `JustificatifPreviewBlock` avec thumbnail cliquable / encadré ambre `Aucun justificatif associé` + bouton `Associer un justificatif`). Le `ManualAssociationDrawer` mode targeted est branché sur `editSource.{operation_file, operation_index, libelle, date, debit, credit, categorie, sous_categorie}` quand on est en édition (au lieu du candidate). **Helper Lightbulb** sous le champ Désignation : icône `Lightbulb` violette + texte « Donne un nom court et descriptif (ex : « Ordinateur », « Fauteuil bureau ») » + suffixe contextuel « Cette immo a été créée depuis le libellé bancaire — à renommer. » quand `isLibelleBrut(designation)` true. **Lightbox chaînée** : nouveau state `lightboxFilename`, le `PreviewSubDrawer` reçoit `onOpenLightbox={() => setLightboxFilename(activeJustifFilename)}` ; un `<JustifPreviewLightbox>` est monté à la fin du composant. **Z-stack Esc** : la lightbox a son propre listener en mode capture (`stopPropagation`) → ferme uniquement elle-même ; sinon le handler du drawer ferme dans l'ordre lightbox > sub-drawer > manual-assoc > drawer principal.

- **Vérifications preview**
  - 3 immos affichées sur 2026, 10 colonnes (`Justif.` en avant-dernière), 3 paperclips verts cliquables.
  - Libellé `PRLVSEPAPAYPALEUROPES.A.R.L.ETCIE 4506,99` en italique gris (heuristique `isLibelleBrut` détecte `PRLV`).
  - Clic paperclip → `PreviewSubDrawer` standalone 700px right-0 avec backdrop noir/blur ; bouton `Maximize2` → `JustifPreviewLightbox` 90vw × 90vh avec PDF chargé.
  - Esc ferme la lightbox seule sans toucher au sub-drawer parent (z-stack capture mode validé).
  - Bouton crayon ouvre input édition avec valeur courante, Esc annule sans appel API.
  - Drawer édition affiche section `OPÉRATION SOURCE & JUSTIFICATIF` + thumbnail PDF + bouton « Voir dans l'éditeur » + helper Lightbulb sous Désignation.

### Added (2026-04-29) — Envoi comptable enrichi amortissements (rapports + ZIP avec justifs liés + bouton header)

Pipeline de transitivité `immo → op → justif` rendu actionnable côté rapports + ZIP envoi. Les rapports `amortissements_registre` portent une colonne « Justificatif » (PDF/CSV/XLSX) ; les 2 rapports amortissements portent `linked_justifs` dans leur metadata GED ; le ZIP envoyé au comptable inclut un sous-dossier dédié `Justificatifs_immobilisations/` dédupliqué ; bouton « Envoyer au comptable » dans le header de la page Amortissements qui auto-génère les rapports manquants pour l'année courante.

- **Backend — helper transitivité op + justif (amortissement_service)**
  - **[`backend/services/amortissement_service.py`](backend/services/amortissement_service.py)** — index inversé `_get_immo_op_index()` (`{immo_id: (op_file, op_index)}`, lazy + thread-safe via `threading.Lock`, invalidé sur `link_operation_to_immobilisation` et `delete_immobilisation`). Helper `get_linked_op_with_justif(immo_id) -> Optional[dict]` : pour un immo, retrouve l'op source (via index inversé) puis lit son `Lien justificatif` ; filtre les liens `reports/...` (PDF rapports forfaits, pas des justifs métier). Helper `list_immobilisations_with_source(statut?, poste?, year?) -> list[dict]` : variante de `get_all_immobilisations` qui enrichit chaque immo avec `has_justif: bool` + `justif_filename: Optional[str]`. Pré-charge les fichiers d'ops concernés en bulk (set unique) pour éviter le N+1 sur les rendus de rapport / liste enrichie.

- **Backend — colonne « Justificatif » dans les rapports registre**
  - **[`backend/services/amortissement_report_service.py`](backend/services/amortissement_report_service.py)** — `render_registre()` consomme désormais `list_immobilisations_with_source(year=year)` au lieu de `list_immobilisations_enriched(year=year)`. Helper local `_format_justif_cell(immo) -> tuple[str, bool]` retourne `("✓ {filename}", True)` ou `("✗", False)` ; filename tronqué milieu si > 30 chars (ex. `apple_20240312_2…00.pdf`). Helpers `_has_justif(immo)` et `_justif_filename(immo)` accept dict ou Pydantic via duck-typing. PDF paysage 10 colonnes (largeurs réajustées 44/20/18/18/12/22/22/22/20/38 mm) avec couleurs conditionnelles : violet `#3C3489` si présent, gris `#999999` sinon. Ligne TOTAL affiche `N / M` coloré ambre `#F59E0B` si incomplet ou vert `#16A34A` si tous justifiés. CSV 13 colonnes avec `Justificatif` en dernière position, ligne TOTAL `5 / 7 immobilisations justifiées`. XLSX 13 colonnes avec mise en forme conditionnelle par cellule : fond violet soft `#EEEDFE` + texte `#3C3489` bold si présent, fond ambre soft `#FEF3C7` + texte `#854F0B` si vide. Le rapport `amortissements_dotations` n'a PAS de colonne dédiée mais bénéficie quand même de `linked_justifs` dans `rapport_meta`.

- **Backend — `linked_justifs` dans `rapport_meta` GED**
  - **[`backend/services/report_service.py`](backend/services/report_service.py)** — nouvelle fonction `_compute_linked_justifs(template_id, filters, year) -> list[str]` calculée à la génération (basenames dédupliqués des justifs liés aux immos en scope). Pour `amortissements_dotations`, restreint aux immos avec `dotation_brute > 0` sur l'exercice. Injecté dans les 2 paths de génération : `get_or_generate()` (templates custom renderer) et `generate_report()` legacy. Backward compat : les rapports legacy sans `linked_justifs` sont traités comme `[]`. **Gelé à la génération** — pas de re-scan à l'envoi (un rapport envoyé représente l'état des justifs au moment de sa génération).
  - **[`backend/services/ged_service.py`](backend/services/ged_service.py)** — `register_rapport()` accepte un nouveau param `linked_justifs: Optional[list[str]] = None` ajouté dans `rapport_meta` si non None.

- **Backend — sous-dossier `Justificatifs_immobilisations/` dans le ZIP envoi (3 passes + dédup)**
  - **[`backend/services/email_service.py`](backend/services/email_service.py)** — helper `_collect_linked_justifs(documents)` lit `rapport_meta.linked_justifs` de chaque rapport présent dans la sélection (lookup par basename, best-effort sur erreur metadata). `_create_zip` (mode SMTP) et `_create_manual_zip` (mode envoi manuel) appliquent désormais 3 passes : (1) skip des justifs cochés manuellement déjà listés comme linked → priorité au sous-dossier dédié pour la déduplication, (2) ajout des autres docs dans leurs sous-dossiers standards, (3) ajout des justifs liés dans `Justificatifs_immobilisations/` via `justificatif_service.get_justificatif_path(basename, include_reports=False)` (strict `data/justificatifs/`, log warning sans crash si justif manquant physiquement). `_build_doc_tree` (preview email) et `_build_zip_tree` (post-création) reflètent le nouveau sous-dossier dans l'arborescence affichée. `generate_email_body_plain` ajoute une section dédiée « Justificatifs des immobilisations (N) » en mode plain text. Constante `IMMO_JUSTIFS_FOLDER = "Justificatifs_immobilisations"` exportée.

- **Frontend — types + hook + bouton header**
  - **[`frontend/src/types/index.ts`](frontend/src/types/index.ts)** — `RapportMeta.linked_justifs?: string[]`.
  - **[`frontend/src/hooks/useAmortissements.ts`](frontend/src/hooks/useAmortissements.ts)** — nouveau hook `usePrepareAmortissementsEnvoi()` retournant `{rapports: GedDocument[], linkedJustifs: string[], generatedCount: number}`. Pipeline : (1) fetch les 2 rapports `amortissements_registre` + `amortissements_dotations` via `GET /api/ged/documents?type=rapport&year=X` filtrés par `template_id`, (2) auto-génère ceux qui manquent via `POST /api/reports/generate` (PDF par défaut), (3) re-fetch avec invalidations `['ged-documents'/'ged-tree'/'reports-gallery']` pour récupérer les `linked_justifs` fraîchement calculés, (4) agrège les `linked_justifs` dédupliqués des 2 rapports.
  - **[`frontend/src/components/amortissements/AmortissementsPage.tsx`](frontend/src/components/amortissements/AmortissementsPage.tsx)** — bouton « Envoyer au comptable » (icône `Send`) dans le `PageHeader` à côté du bouton Config. Pattern miroir Charges Forfaitaires. Handler `handleEnvoiComptable` lance `toast.loading('Préparation de l\'envoi comptable…')`, appelle `prepareEnvoi.mutateAsync(selectedYear)`, construit `preselected: DocumentRef[]` (basename dérivé via `doc_id.split('/').pop()` car `GedDocument` n'expose pas `filename` directement), appelle `useSendDrawerStore.open({ preselected, defaultSubject: 'Amortissements — Exercice {year}', defaultFilter: 'rapport' })`. Toast success listant `N rapport(s) + M justificatif(s)`, toast error sinon.

- **Vérification preview** — clic bouton → drawer s'ouvre avec 2 rapports cochés, filtre Rapports actif (chip violet), objet pré-rempli `Amortissements — Exercice 2025`, footer `2 documents sélectionnés` + bouton primary `Envoyer (2 docs)`, prêt pour SMTP ou envoi manuel.

- **Note** : pas de re-scan dynamique des `linked_justifs` côté ZIP — pour propager une nouvelle association justif/op vers un rapport déjà généré, il faut régénérer le rapport (le `dedup_key` de `get_or_generate` recycle le filename mais met à jour les metadata).

### Fixed + Added (2026-04-29) — Anticipation régularisation URSSAF + fix bug pro-rata `compute_urssaf_deductible` + auto-run lifespan

Triple chantier dans la même session : (1) **fix structurel d'un bug pré-existant** dans `compute_urssaf_deductible` qui marquait jusqu'à 100 % de l'URSSAF comme non-déductible (BNC sur-évalué), (2) **automatisation du batch CSG/CRDS** au lifespan boot (idempotent, couvre N-2/N-1/N), (3) **nouveau module d'anticipation des régularisations URSSAF** sur 3 surfaces (drawer Compta Analytique + panel Simulation BNC + Prévisionnel) avec auto-task d'alerte (8e détection).

- **Fix `compute_urssaf_deductible` — formule pro-rata**
  - **[`backend/services/fiscal_service.py`](backend/services/fiscal_service.py)** — Avant : `non_deductible = round(assiette × 2,9 %, 2)` puis `min(non_deductible, montant_brut)`. Quand appelée per-op (depuis `run_batch_csg_split` ou le widget UI), chaque op recevait jusqu'à l'intégralité du non-déductible **annuel** capé à son montant. Sur 2024 (10 ops URSSAF, total 20 546 €), les 10 ops avaient toutes `non_deductible == Débit` (100 % marqué non-déductible) → URSSAF disparaissait totalement de `charges_pro` → BNC sur-évalué de ~16 k €. Fix : nouveau param optionnel `total_urssaf_annuel: Optional[float] = None`, calcul `annual_non_deductible / total_urssaf_annuel = ratio` puis `non_deductible_op = montant × ratio`. Si `total_urssaf_annuel` non fourni, auto-fetch via nouveau helper `_compute_total_urssaf_debit_annuel(year)` (lazy load `operation_service`). Helpers `_is_urssaf_op` et `_URSSAF_KEYWORDS` déplacés du router vers le service. Reset des 24 ops corrompues (10×2024 + 12×2025 + 2×2026) via `force=True`, ratios finaux 8,2-20,8 % (vs 100 % bug).

- **Auto-run `batch-csg-split` au lifespan boot**
  - **[`backend/main.py`](backend/main.py)** — appelé après `_migrate_amortissement_config()` pour `[N−2, N−1, N]` (couvre N-2 = ancien exercice à clôturer, N-1 = clôture en cours, N = exercice courant). Idempotent grâce au skip natif `if not force and op.csg_non_deductible: skip`. Le boot bloque ~1-2 s max (logique sync, lecture barème JSON + écriture fichiers ops). Pattern miroir des autres migrations (try/except → `logger.warning`, jamais bloquant). Log `info` uniquement si `updated > 0`.
  - **[`backend/services/fiscal_service.py`](backend/services/fiscal_service.py)** — nouvelle fonction `run_batch_csg_split(year, force) -> dict` (déplacée depuis le router, sync). Pré-calcule `total_urssaf_annuel` **une fois** par année puis injecte dans chaque appel `compute_urssaf_deductible`. Retourne `{year, bnc_estime, total_urssaf_annuel, updated, skipped, files_touched, total_non_deductible}`.
  - **[`backend/routers/simulation.py`](backend/routers/simulation.py)** — endpoint `POST /api/simulation/batch-csg-split` réduit à thin wrapper `return fiscal_service.run_batch_csg_split(year, force)`. Nettoyage : suppression de l'import `operation_service` et de la constante `_URSSAF_KEYWORDS` désormais inutiles côté router.

- **Nouveau service `urssaf_provisional_service`**
  - **[`backend/services/urssaf_provisional_service.py`](backend/services/urssaf_provisional_service.py)** *(nouveau)* — 4 fonctions pures composant l'existant (`bnc_service.compute_bnc`, `fiscal_service.estimate_urssaf` / `forecast_bnc`, `liasse_scp_service.get_ca_for_bnc`). (a) `compute_urssaf_regul_estimate(year)` retourne `{bnc_n, urssaf_du, urssaf_paye_cash, ecart_regul, signe: "regul"|"remboursement"|"equilibre", confiance: "definitif"|"provisoire", taux_couverture}` ; `confiance: "definitif"` si liasse SCP saisie. (b) `compute_acompte_theorique(year)` calcule l'acompte URSSAF théorique de N sur la base du BNC N-2. (c) `project_cotisations_multi_years(start_year, horizon=5)` projette URSSAF dû/acompte/régul sur N années (BNC réel ou forecast). (d) `compute_bnc_delta_pct(year)` retourne l'écart relatif BNC N vs N-2 (utilisé par task_service).

- **3 nouveaux endpoints**
  - **[`backend/routers/simulation.py`](backend/routers/simulation.py)** — `GET /api/simulation/urssaf-regul/{year}`, `GET /api/simulation/urssaf-acompte-theorique/{year}`, `GET /api/simulation/urssaf-projection?start_year=&horizon=` (default 5).

- **Auto-task `urssaf_regul_alert` (8e détection)**
  - **[`backend/services/task_service.py`](backend/services/task_service.py)** — insérée entre `dotation_manquante` et `ml_retrain`. Si `|delta BNC N vs N-2| ≥ 30 %` ET `|ecart_regul| ≥ 1 000 €` (seuils en dur, pas de toggle settings), crée une tâche `auto_key=urssaf_regul_alert_{year}`, priority `haute` si delta ≥ 50 % sinon `normale`, metadata `{year, bnc_delta_pct, ecart_regul, signe, confiance, action_url}`. Idempotente via dedup `auto_key` du router. Sur le corpus user actuel (BNC 2024 = 117 k€, BNC 2026 partiel = 27 k€, delta -77 %), tâche priority haute générée pour 2026.

- **Frontend — section drawer URSSAF**
  - **[`frontend/src/components/compta-analytique/CategoryDetailDrawer.tsx`](frontend/src/components/compta-analytique/CategoryDetailDrawer.tsx)** — nouvelle section « **Régularisation URSSAF estimée** » sous Déductibilité CSG/CRDS, conditionnelle (`isUrssafCategory && month === null && quarter === null`, vue annuelle uniquement). 4 lignes : URSSAF dû / URSSAF payé / écart `+X €` (vert) ou `−X €` (rouge) selon `signe`, badge `definitif` (vert) ou `provisoire` (ambre), note `appel typique octobre/novembre N+1`. Convention de signe **flux côté utilisateur** : `remboursement = +X €` (argent qui rentre, vert) ; `regul = −X €` (argent qui sort, rouge). Hook `useUrssafRegul(year, enabled)` avec gating `enabled` pour éviter fetch hors scope.
  - Copy du bloc **Déductibilité CSG/CRDS** clarifié : `Calcul : 2,9 % × assiette CSG/CRDS (BNC × 0,74 ≥ 2025 ; BNC + cotisations sociales ≤ 2024), réparti au pro-rata des paiements URSSAF de l'année. Exclu du BNC.` + note italique `Approximation cash basis — ne distingue pas les acomptes (base N−2) des régularisations (base N−1) dans les paiements de l'année.`.

- **Frontend — panel projection 5 années**
  - **[`frontend/src/components/simulation/SimulationPrevisionsSection.tsx`](frontend/src/components/simulation/SimulationPrevisionsSection.tsx)** — nouveau bloc « **Projection cotisations URSSAF** » après le tableau historique annuel. `startYear = currentYear - 2`, horizon 5 par défaut. Tableau colonnes `Année / BNC / URSSAF dû / Acompte (sur N-2) / Régul estimée / Statut`. Badge `passé`/`courant`/`futur` + badge `forecast` ambre quand `bnc_origine === "forecast"`. Note italique sur fiabilité du forecast quand historique court (régression linéaire, BNC négatifs hallucinés possibles si <36 mois). Convention signe identique au drawer (régul = −, remboursement = +).

- **Frontend — Prévisionnel `type_cotisation`**
  - **[`backend/models/previsionnel.py`](backend/models/previsionnel.py)** — nouveau type `TypeCotisation = Literal["urssaf_acompte", "urssaf_regul"]`, champ `type_cotisation: Optional[TypeCotisation] = None` ajouté à `PrevProvider`, `PrevProviderCreate`, `PrevProviderUpdate` et `TimelinePoste`. Pas de migration de données — providers existants conservent `None`.
  - **[`backend/services/previsionnel_service.py`](backend/services/previsionnel_service.py)** — `get_timeline()` branche : `type_cotisation == "urssaf_acompte"` → 12 échéances mensuelles, montant = `compute_acompte_theorique(year).mensuel` (auto-calculé sur BNC N-2) ; `type_cotisation == "urssaf_regul"` → 1 échéance en novembre N, montant = régul estimée de N-1 (si > 0). Lazy-load `urssaf_provisional_service` uniquement si au moins un provider URSSAF typé existe (zéro overhead pour les users qui n'utilisent pas la fonctionnalité).
  - **[`frontend/src/components/previsionnel/ProviderDrawer.tsx`](frontend/src/components/previsionnel/ProviderDrawer.tsx)** — nouveau dropdown « Type de cotisation » (Standard / URSSAF acompte / URSSAF régul N-1) après le champ Catégorie + note explicative dynamique selon la sélection.
  - **[`frontend/src/components/previsionnel/MonthExpansion.tsx`](frontend/src/components/previsionnel/MonthExpansion.tsx)** — badges dans les lignes timeline : `Acompte` (cyan `bg-sky-500/15 text-sky-400`) et `Régul N−1` (ambre `bg-amber-500/15 text-amber-400`).

- **Frontend — types + hooks**
  - **[`frontend/src/types/index.ts`](frontend/src/types/index.ts)** — ajout `TypeCotisation`, `UrssafRegulEstimate`, `UrssafAcompteTheorique`, `UrssafProjectionRow`. Champ `type_cotisation?` ajouté à `PrevProvider`, `PrevProviderCreate`, `TimelinePoste`.
  - **[`frontend/src/hooks/useSimulation.ts`](frontend/src/hooks/useSimulation.ts)** — 3 nouveaux hooks `useUrssafRegul(year, enabled?)`, `useUrssafAcompteTheorique(year, enabled?)`, `useUrssafProjection(startYear, horizon?, enabled?)`. Gating `enabled` pour éviter fetch hors scope.

- **Données vérifiées sur le corpus user**
  | Année | BNC | URSSAF dû | URSSAF payé cash | Écart | Confiance |
  |-------|-----|-----------|------------------|-------|-----------|
  | 2024  | 117 727 € | 24 334 € | 20 546 € | **+3 788 € (régul)** | provisoire |
  | 2025  | 228 929 € | 47 024 € | 56 803 € | **−9 779 € (remboursement)** | définitif (liasse) |
  | 2026  | 26 977 € (partiel) | 4 659 € | 7 018 € | **−2 359 € (remboursement)** | provisoire |

- **Limitations connues**
  - La projection multi-années dépend de `forecast_bnc()` (régression linéaire saisonnière) — peu fiable au-delà de N+1 si l'historique BNC fait moins de 36 mois (BNC négatifs hallucinés possibles, signalés par badge `forecast` ambre).
  - L'auto-task `urssaf_regul_alert` ne se déclenche QUE si BNC N-2 est dans le système. Sur le corpus user (historique commence 2024), elle ne se déclenche pas pour 2024/2025 (BNC 2022/2023 indispo) — uniquement pour 2026 (BNC 2024 dispo).
  - Le calcul de l'écart régul mélange acomptes N (base BNC N-2) et régul N-1 (base BNC N-1) dans les paiements de l'année (limitation cash basis comptable BNC) — approximation documentée dans le copy du drawer.

### Added (2026-04-29) — Cohérence OD forfaits (blanchissage / repas / véhicule signalétique) + badge Forfait + filtre + carte Compta Analytique

Les 3 forfaits déductibles (blanchissage, repas, véhicule) sont désormais visibles uniformément dans l'Éditeur + Justificatifs + Compta Analytique avec un badge cyan dédié. Le véhicule, qui n'avait historiquement aucune écriture comptable (juste un ratio sur poste GED), reçoit une OD signalétique au 31/12 (`Débit=0`/`Crédit=0`) qui sert de point d'accroche pour le PDF rapport sans changer la mécanique de déduction. Toute la chaîne « OD → PDF rapport en GED → trombone cliquable » est réparée pour les 3 sources.

- **Backend — création OD avec champ `source`**
  - **[`backend/services/charges_forfaitaires_service.py`](backend/services/charges_forfaitaires_service.py)** — `generer_od()` (blanchissage) et `generer_repas()` posent désormais `source: "blanchissage"` / `"repas"` à la création de l'OD au 31/12 (manquait, ce qui cassait silencieusement la détection `sources_attendues` dans `check_envoi_service.py:455`). `appliquer_vehicule()` crée en 7ᵉ étape une **OD signalétique** via le nouveau helper `_create_or_update_vehicule_od(year, ratio_pro, pdf_filename)` (Débit=0/Crédit=0, `source: "vehicule"`, `Catégorie: "Véhicule"`, `Sous-catégorie: "Quote-part professionnelle"`, `Lien justificatif: "reports/quote_part_vehicule_{year}.pdf"`, `lettre: True`). Idempotente (rafraîchit l'existante si retrouvée via `_find_vehicule_od(year)`). `supprimer_vehicule()` appelle `_remove_vehicule_od(year)` en best-effort. La déduction comptable continue de passer par le ratio `deductible_pct` du poste GED `vehicule` — l'OD est purement signalétique, ne touche pas à `charges_pro`.

- **Backend — migration boot idempotente**
  - **[`backend/main.py`](backend/main.py)** *(nouveau helper)* — `_migrate_forfait_sources_and_links()` appelée dans le `lifespan` AVANT `apply_link_repair`. Phase 1 : pour chaque op `type_operation == "OD"` avec `Catégorie == "Blanchissage professionnel"` ou `Catégorie == "Repas pro" ET Sous-catégorie == "Repas seul"`, pose `source` si vide ET restaure `Lien justificatif` si vide via lookup pattern `{source}_{year}*.pdf` dans `data/reports/`. Phase 2 : pour chaque `data/baremes/vehicule_{year}.json` avec `ratio_pro_applique` non null + PDF `quote_part_vehicule_{year}.pdf` présent, crée l'OD signalétique via `_create_or_update_vehicule_od` (cas user existant). Idempotente : 2ᵉ run = 0 modif silencieux. Logs `info` séparés pour sources / liens / OD véhicule créées.

- **Backend — préservation paths `reports/...` dans `apply_link_repair`**
  - **[`backend/services/justificatif_service.py`](backend/services/justificatif_service.py)** — `scan_link_issues()` (~ligne 1218) ne marque plus comme `ghost_refs` les liens préfixés `reports/` qui pointent vers un PDF existant dans `data/reports/` (`if (REPORTS_DIR / name).exists(): continue`). Avant ce fix, `apply_link_repair` au boot purgeait silencieusement les `Lien justificatif: "reports/..."` (faux positif — il considérait ces fichiers comme absents du dossier `data/justificatifs/`), ce qui rendait les PDF rapports OD blanchissage/repas/véhicule inaccessibles depuis l'Éditeur. Bug confirmé sur l'instance utilisateur (2 OD blanchissage+repas avec `Lien justificatif: ""` retrouvé après inspection du fichier décembre 2025).

- **Backend — endpoint preview/thumbnail/open-native avec fallback `data/reports/`**
  - **[`backend/services/justificatif_service.py`](backend/services/justificatif_service.py)** — `get_justificatif_path(filename, include_reports: bool = False)` accepte un opt-in `include_reports=True` qui ajoute `data/reports/` comme 3ᵉ fallback (après `en_attente/` et `traites/`). En lecture seule. Les mutations (`delete_justificatif`, `rename_justificatif`, OCR background dans `_run_ocr_background`) restent par défaut sans le fallback — protection contre la suppression/rename accidentels d'un PDF rapport.
  - **[`backend/routers/justificatifs.py`](backend/routers/justificatifs.py)** — `GET /{filename}/preview`, `/thumbnail`, `POST /open-native` passent désormais `include_reports=True`. Le trombone des OD forfaits ouvre directement le PDF rapport stocké dans `data/reports/` (transparent côté frontend, pas de changement UI nécessaire).

- **Frontend — composant ForfaitBadge + intégration**
  - **[`frontend/src/components/shared/ForfaitBadge.tsx`](frontend/src/components/shared/ForfaitBadge.tsx)** *(nouveau)* — badge cliquable cyan (palette `#CFF1F1` bg, `#0E5566` text, `#5BB7B7` border), icône `Sparkles` (Lucide), libellé adaptatif `Forfait blanchissage` / `Forfait repas` / `Forfait véhicule` selon prop `source`. Pattern miroir `DotationBadge` / `ImmoBadge`. Clic → `navigate('/charges-forfaitaires?tab={source}')`. Tooltip `Écriture OD · forfait {source} (charge déductible 31/12)`.
  - **[`frontend/src/components/editor/EditorPage.tsx`](frontend/src/components/editor/EditorPage.tsx)** + **[`frontend/src/components/justificatifs/JustificatifsPage.tsx`](frontend/src/components/justificatifs/JustificatifsPage.tsx)** + **[`frontend/src/pages/AlertesPage.tsx`](frontend/src/pages/AlertesPage.tsx)** — détection `forfaitSource = (op.source === 'blanchissage' || op.source === 'repas' || op.source === 'vehicule') ? op.source : null`, badge intégré dans le wrapper `<div className="flex flex-wrap gap-1 mb-1">` qui regroupe les autres badges (Note de frais / Immo / Dotation).

- **Frontend — filtre `OperationTypeFilter` + dropdowns**
  - **[`frontend/src/lib/utils.ts`](frontend/src/lib/utils.ts)** — type `OperationTypeFilter` étendu avec `'forfait'`. `matchesOperationType` ajoute `case 'forfait': return op.source === 'blanchissage' || op.source === 'repas' || op.source === 'vehicule'`. **Effet bénéfique automatique** : le filtre `bancaire` (`!op.source && !op.immobilisation_id`) exclut désormais les 3 forfaits — cohérent avec la dotation amortissement déjà exclue.
  - **EditorPage** + **JustificatifsPage** + **AlertesPage** — option `<option value="forfait">Forfait</option>` ajoutée au dropdown `Type d'opération`.

- **Frontend — 5ᵉ carte « Forfait » dans `RepartitionParTypeCard`**
  - **[`frontend/src/components/compta-analytique/ComptaAnalytiquePage.tsx`](frontend/src/components/compta-analytique/ComptaAnalytiquePage.tsx)** — `RepartitionParTypeCard` étendu à 5 cartes (Bancaire / Notes de frais / Immobilisations / Dotation / **Forfait**). `forfaitDebit = (blanchissage?.debit ?? 0) + (repas?.debit ?? 0) + (vehicule?.debit ?? 0)` ; `forfaitCount` somme les 3 sources. Grid `lg:grid-cols-4` → `lg:grid-cols-5`. Palette cyan cohérente avec `ForfaitBadge`. Sur l'instance user 2025 : 5 010,70 € sur 3 ops = 1.2 % du total dépenses.

### Added (2026-04-29) — Garde stricte saisie hors mois (Éditeur handleSave)

Empêche la pollution accidentelle d'un fichier mensuel quand l'utilisateur saisit une date hors du mois du fichier ouvert (typiquement via « + Ligne ▾ → Note de frais (CB perso) » avec une date d'un autre mois). Bug observé : 3 ops mars 2026 (essence) + 1 op avril 2026 ajoutées par erreur dans le fichier décembre 2025 (`operations_merged_202512_*.json`). Cleanup data en parallèle (cf. ci-dessous).

- **[`frontend/src/components/editor/EditorPage.tsx`](frontend/src/components/editor/EditorPage.tsx)** — `handleSave` extrait le `YYYYMM` du filename via regex `operations_(merged|split|manual)_(\d{4})(\d{2})_` (les fichiers d'import bancaire libres au pattern non standard sont exemptés — ils peuvent légitimement couvrir 2 mois à cheval). Si une op a une `Date` qui ne commence pas par `{YYYY}-{MM}`, le save est refusé avec un toast d'erreur 6 secondes : `{N} ligne(s) hors du mois {MOIS_FR} {YYYY} ({jusqu'à 3 dates exemples}). Bascule sur le bon mois pour saisir ces lignes.`. Validation côté frontend uniquement — un client API direct peut toujours forcer une saisie cross-mois (cas légitime utilisé par `_find_or_create_december_file` pour les OD forfaits/dotation au 31/12).

### Added (2026-04-29) — Auto-rapprochement scope-mois à l'import du relevé bancaire

Les justificatifs scannés AVANT l'import d'un relevé bancaire restaient en `en_attente/` même après l'import (auto-rapprochement non re-déclenché sur les justifs déjà OCR-isés). L'utilisateur devait cliquer manuellement « Associer automatiquement » dans la JustificatifsPage. Désormais l'auto-rapprochement se relance automatiquement à la fin de l'import, scopé sur le mois dominant des ops importées (perf ~0,2 s vs 1-2 s en global).

- **[`backend/routers/operations.py`](backend/routers/operations.py)** — `POST /api/operations/import` calcule le mois dominant des ops importées via un dict `month_counts: dict[str, int]` (clé `YYYY-MM`, valeur = nombre d'ops). Si `month_counts` non vide, lance `rapprochement_service.run_auto_rapprochement(dominant_year, dominant_month)` en `BackgroundTasks`. Fallback global (sans scope) si aucune date exploitable dans les ops importées. Le scope ±1 mois est déjà supporté par `run_auto_rapprochement` ([backend/services/rapprochement_service.py:954](backend/services/rapprochement_service.py:954)) et bénéficie du cache ML cleared en début de run.

### Fixed (2026-04-29) — Cleanup data ad-hoc : 4 ops mal placées (cross-mois) + reindex GED/OCR

Cleanup ponctuel sur l'instance utilisateur, applicable à toute installation présentant le même symptôme.

- **3 ops mars 2026** (essence : 19/03 133,81 €, 25/03 25,99 €, 28/03 141,56 €) déplacées du fichier `operations_merged_202512_20260414_234739.json` (décembre 2025) vers `operations_manual_202603_7b199f8d.json` (mars 2026). Indices originaux 0, 1, 2 → fichier décembre passe de 90 à 87 ops.
- **1 op avril 2026** (15/04, débit 0) déplacée du fichier `operations_manual_202603_7b199f8d.json` (mars 2026, mal nommé) vers nouveau fichier `operations_manual_202604_81b1e054.json` (avril 2026). Format hex8 cohérent avec `operation_service.create_empty_file`.
- **1 fichier mars 2026 vide en doublon supprimé** : `operations_manual_202603_33135d29.json` (0 ops) — le user en avait 2 fichiers mars 2026 coexistants.
- **49 refs GED** reindexées dans `data/ged/ged_metadata.json` (formats `dict {file, index, ventilation_index}` et string `"file:index"` tous deux supportés). Indices > 2 dans le fichier décembre décrémentés de 3.
- **5 refs OCR** reindexées dans `data/justificatifs/{en_attente,traites}/*.ocr.json`.
- **2 refs orphelines** détectées et redirigées vers le nouveau fichier mars 2026 (fac-similés essence 20260319 + 20260325 qui pointaient vers les anciens indices 0/1 du fichier décembre).
- **Backups** : `data/imports/operations/_archive/{file}.bak_20260429_123048` (3 fichiers : décembre, mars, ged_metadata).

### Added (2026-04-29) — Suppression d'immobilisation cascade + toast de confirmation custom

Bouton de suppression d'immobilisation enfin disponible dans l'UI (le hook `useDeleteImmobilisation` existait depuis longtemps mais n'était consommé nulle part), avec cascade backend qui dénoue proprement l'opération bancaire liée et un toast de confirmation custom élégant qui remplace le `window.confirm` natif.

- **Backend**
  - **[`backend/services/amortissement_service.py:225`](backend/services/amortissement_service.py:225)** — réécriture de `delete_immobilisation(immo_id) -> Optional[dict]`. Au lieu de retirer simplement l'entrée du registre JSON et retourner `bool`, la fonction cascade les ops liées : pour chaque op avec `immobilisation_id == immo_id`, on `pop` les champs `immobilisation_id` + `immobilisation_candidate`, et on vide `Catégorie`/`Sous-catégorie` UNIQUEMENT si `Catégorie == "Immobilisations"` (préservation des recategorisations manuelles). Calcule aussi `affected_years` via `compute_tableau(immo)` (filtré `is_backfill=False`) pour signaler à l'UI les exercices dont l'OD dotation devient potentiellement obsolète. Retire l'entrée du registre EN DERNIER (cohérence en cas de crash en amont). Retourne `{status: "deleted", immo_id, designation, ops_unlinked: [{filename, index, libelle, date}], affected_years}` ou `None` si immo introuvable. **Ne touche PAS** à l'OD dotation (`supprimer_dotation_ecriture` non appelé) — trop dangereux par effet de bord si d'autres immos actives sur la même année. La 7ᵉ task auto `dotation_manquante` réapparaîtra naturellement si l'OD existait → user clique « Régénérer » dans l'onglet Dotation.
  - **[`backend/routers/amortissements.py:182`](backend/routers/amortissements.py:182)** — `DELETE /api/amortissements/{immo_id}` retourne désormais le dict du service (au lieu de `{success: true}` legacy). 404 si `result is None`.

- **Frontend**
  - **[`frontend/src/hooks/useAmortissements.ts:96`](frontend/src/hooks/useAmortissements.ts:96)** — `useDeleteImmobilisation` étendu : type retour `DeleteImmobilisationResult` exporté, invalidations enrichies (`['operations']`, `['analytics']`, `['dashboard']`, `['year-overview']`, `['tasks']`, `['alertes']`, `['amortissement-candidates']` en plus de `['amortissements']` + `['amortissement-kpis']`). Le `toast.success` inline est retiré → délégué au composant pour un toast riche avec compteur ops + `affected_years`.
  - **[`frontend/src/lib/deleteImmobilisationToast.ts`](frontend/src/lib/deleteImmobilisationToast.ts)** *(nouveau)* — helper `showDeleteImmoConfirmToast(designation, onConfirm)` qui rend un toast custom centré (`position: 'top-center'`, `duration: 12000`) plus riche que `showDeleteConfirmToast` (justificatifs) car la cascade touche le registre + ops + potentiellement la dotation. Card 440px avec : (a) icône `Trash2` rouge dans cercle `bg-danger/15 border-danger/30`, (b) titre semibold + désignation tronquée 56 chars avec icône `Landmark`, (c) bullets explicatives (3 puces) dans card `bg-surface-hover/50`, (d) bandeau warning irréversible `bg-danger/10 border-danger/20` avec `AlertTriangle`, (e) boutons Annuler ghost / Supprimer rouge plein avec icône `Trash2`. Animations `animate-in fade-in zoom-in-95 duration-200` à l'entrée, symétrique à la sortie.
  - **[`frontend/src/components/amortissements/ImmobilisationDrawer.tsx`](frontend/src/components/amortissements/ImmobilisationDrawer.tsx)** — bouton `Trash2` rouge en pied du drawer (`bg-danger/10 text-danger border-danger/30`), visible UNIQUEMENT en mode édition pure (`isEdit && !isCandidate && !readonly`). Footer passe à `justify-between` dans ce cas (Supprimer à gauche, Annuler/Enregistrer à droite). `handleDelete` appelle `showDeleteImmoConfirmToast` puis `deleteMutation.mutateAsync` ; toast vert succès avec compteur ops déliées, et toast ambre additionnel si `affected_years.length > 0` (« OD dotation potentiellement obsolète pour 2025, 2026… — régénère via l'onglet Dotation. »).

### Added (2026-04-29) — Bulk-lettrage Éditeur (BulkLettreBar) + multi-sélection sur colonne Pointée

Nouveau pattern de sélection multi-ops sur la colonne Pointée (badge vert) de l'Éditeur, miroir du bulk-lock existant mais en palette emerald. Le header devient un bouton tri-état qui sélectionne toutes les ops lettrables du fichier ; chaque cellule expose une checkbox au hover ; une barre flottante en bas permet de pointer/dépointer N ops en un appel API.

- **Frontend — composants nouveaux**
  - **[`frontend/src/components/BulkLettreBar.tsx`](frontend/src/components/BulkLettreBar.tsx)** *(nouveau)* — barre flottante palette emerald, pattern strictement miroir de `BulkLockBar`. Toggle automatique `Pointer (N)` ↔ `Dépointer (N)` selon `allLettrees: bool` (true → toutes les ops sélectionnées sont déjà lettrées → bouton bascule en grise pour défaire). Position `bottom-6` par défaut, `bottom-24` si `shifted={true}` (utilisé pour empiler quand bulk-lock est aussi actif). Loader `Loader2` animé pendant la mutation.

- **Frontend — Éditeur**
  - **[`frontend/src/components/editor/EditorPage.tsx`](frontend/src/components/editor/EditorPage.tsx)** — state `lettreSelectedOps: Set<string>` (clés `filename:index`) indépendant de `rowSelection` TanStack et de `lockSelectedOps`. Helpers `lettreKeyFor(op, originalIndex)`, `lettrableOps` (memo : ops non-ventilées uniquement, `(op.ventilation?.length ?? 0) === 0`), `lettrableKeys` (memo : itère `operations.forEach((op, i) => …)` pour préserver l'index source — voir Fixed ci-dessous), `toggleLettreSelection`, `toggleAllLettreSelection` (toggle entre vide / tout sélectionné), `clearLettreSelection`, `lettreSelectedCount`, `isAllLettreSelected`, `isSomeLettreSelected`, `lettreSelectedAllLettrees` (toggle Pointer/Dépointer). Reset auto via `useEffect([selectedFile, allYearMode])`. Handler `handleBulkLettre` : calcule `targetLettre = !lettreSelectedAllLettrees`, filtre les clés du `selectedFile` courant (mono-fichier — backend `/lettrage/{file}/bulk` est par fichier), appelle `bulkLettrageMutation`. Toast adaptatif avec verbe accordé. Header de la colonne Pointée devient un bouton tri-état émeraude (gris / `ring-emerald-500/40` partial / `ring-emerald-500/60` all) avec `e.stopPropagation()` (cf. Fixed). Cellule en 3 modes : (1) non-bulkable (year-wide ou ventilée) → toggle individuel uniquement comme avant, (2) sélection active → checkbox 22px émeraude, (3) repos → bouton Pointée + petite checkbox 18px au hover. Row sélectionnée mise en évidence avec `bg-emerald-500/10`. Render simultané `BulkLettreBar` (à `bottom-6`) + `BulkLockBar` (avec `shifted={lettreSelectedCount > 0}` → `bottom-24` quand les 2 sont actives → empilement vertical).

### Fixed (2026-04-29) — Bulk lettrage 422 (route order FastAPI) + index mapping bulk-lock/lettre

Deux bugs distincts qui faisaient échouer le bulk lettrage : un côté backend (route dynamique interceptait la route statique) et un côté frontend (index décalés sur tableaux filtrés).

- **Backend**
  - **[`backend/routers/lettrage.py`](backend/routers/lettrage.py)** — `POST /{filename}/bulk` était déclarée APRÈS `POST /{filename}/{index}`. FastAPI matche les routes dans l'ordre de déclaration : le `{index}` dynamique interceptait `bulk` et tentait de le parser comme `int` → réponse `422 int_parsing` avec `input: "bulk"` qui se manifestait côté UI comme « Échec du pointage en masse ». **Fix** : route statique `/{filename}/bulk` déclarée AVANT la route dynamique `/{filename}/{index}` + commentaire défensif référençant le pattern miroir `email/manual-zips/cleanup` (déjà documenté dans CLAUDE.md). Pattern à respecter pour toute future route partageant un préfixe.

- **Frontend**
  - **[`frontend/src/components/editor/EditorPage.tsx`](frontend/src/components/editor/EditorPage.tsx)** — bug latent dans `toggleAllLockSelection` (préexistant) et nouveau code `toggleAllLettreSelection` : itéraient `lockableOps.map((op, i) => lockKeyFor(op, i))` / idem lettrage, où `i` était l'index dans le tableau **filtré** (sans les ventilées/non-lockables), pas l'index original dans `operations`. La cellule, elle, utilisait `Number(row.id)` (= index source TanStack, immuable). Mismatch silencieux : sélectionner-tout via le header générait `f:0,f:1,f:2` alors que les vraies ops étaient à `f:0,f:5,f:10` → backend recevait des indices décalés ou hors borne. **Fix** : nouveaux memos `lockableKeys` et `lettrableKeys` qui itèrent `operations.forEach((op, i) => { if (lockable/lettrable) keys.push(keyFor(op, i)) })` pour préserver l'index source. `toggleAll*Selection` consomment ces memos. `isAll*Selected` / `isSome*Selected` réécrits sur `lockableKeys.every(k => set.has(k))` (clé directe). `lettreSelectedAllLettrees` revu : itère `operations` directement (pas `filter` qui re-décalerait) pour vérifier l'état réel des ops sélectionnées.
  - Bonus de cohérence : `lockKeyFor` et `lettreKeyFor` alignés sur le rendu de la cellule (ligne ~1116) — en single-file, on IGNORE désormais `op._sourceFile` (artefact d'un mode year-wide qui aurait été persisté dans le JSON via un legacy save) et on utilise toujours `selectedFile`. Évite les 404 silencieux quand `_sourceFile` pointe vers un fichier mergé/disparu.
  - **[`frontend/src/components/editor/EditorPage.tsx`](frontend/src/components/editor/EditorPage.tsx)** *(autre fix lié)* — bouton header de la colonne Pointée déclenchait à la fois la sélection-all ET le tri TanStack. Le `<th>` parent (ligne ~2286 du render thead) a `onClick={header.column.getToggleSortingHandler()}` qui capture tous les clics du header. Comme `accessorKey: 'lettre'` active le tri par défaut, le clic-bouton bubblait → sort + select-all simultanés → l'effet visible était souvent juste le sort. **Fix** : `e.stopPropagation()` sur le handler du bouton ; la flèche de tri (`ArrowUpDown` rendue à côté du bouton dans le même `<span>`) reste cliquable indépendamment → sort accessible via la flèche, sélection via le bouton.

### Changed (2026-04-29) — Drawer Compta Analytique : refonte totaux + sous-cat cliquables + vue groupée + tri ASC

Plusieurs améliorations cumulées sur le `CategoryDetailDrawer` (drawer de drill-down qui s'ouvre au clic sur une catégorie dans la page Compta Analytique).

- **Tri chronologique des opérations**
  - **[`backend/services/analytics_service.py:438`](backend/services/analytics_service.py:438)** — `get_category_detail()` retournait les ops triées Date DESC (récent → ancien). Refactor en double sort : `cat_df.sort_values("Date", ascending=False).head(50).sort_values("Date", ascending=True)`. On garde DESC + `head(50)` pour sélectionner les 50 ops les plus récentes du périmètre, puis on ré-ordonne ASC pour l'affichage (jan en haut → déc en bas, UX naturelle pour analyse temporelle).

- **Footer Total sticky bottom — pattern miroir Éditeur**
  - **[`frontend/src/components/compta-analytique/CategoryDetailDrawer.tsx`](frontend/src/components/compta-analytique/CategoryDetailDrawer.tsx)** — footer ajouté en bas du drawer (`shrink-0`, reste visible quand on scrolle dans les ops). Bordure haute orange `border-t-2 border-warning`, gradient `from-warning/30 via-warning/25`, shadow vers le haut, symbole `∑`. Affiche compteur ops en italique + Débit (rouge si > 0) + Crédit (vert si > 0) + Solde dans pill colorée (`bg-success/20 ring-success/40` si ≥ 0, `bg-danger/20 ring-danger/40` sinon, préfixe `+/-`). Conditionnel sur `data && data.nb_operations > 0` (pas de footer fantôme pendant le loading). Le `DotationsVirtualDrawer` parallèle a déjà son propre footer — pas touché.

- **Sous-catégories cliquables → filtre les opérations**
  - State `selectedSubCategory: string | null` avec reset auto au changement de `category` / `year` / `month` / `quarter` (les sous-cat dispo varient). Helper d'égalité tolérante : sous-cat vide stockée comme clé `__empty__` → mappée sur libellé « Non classé ». Memos `filteredOps` et `footerTotals` recalculent dynamiquement les totaux quand un filtre est actif (Débit/Crédit/Solde du footer reflètent UNIQUEMENT les ops filtrées).
  - Section *Sous-catégories* du haut : chaque card devient un `<button>` toggle (re-clic sur la même → désélectionne). Visuel actif : `border-primary ring-2 ring-primary/40 bg-primary/5` + icône `Filter` violet à gauche du nom + barre `bg-primary` (au lieu de `bg-primary/70` au repos). Bouton `× Tout voir` dans le header de la section quand un filtre est actif.

- **Vue groupée par sous-catégorie avec sous-totaux inline (vue par défaut)**
  - Quand aucun filtre n'est actif, la liste des ops est désormais **groupée par sous-cat**. Memo `opsGroups: OpsGroup[]` itère `data.operations`, regroupe par sous-cat, somme débit/crédit, trie par montant total DESC (cohérent avec l'ordre de la section sous-cat du haut). Chaque groupe est rendu comme un panel `bg-surface/40` avec :
    - Header cliquable (`<button>`) palette primary : icône `ChevronDown` + nom sous-cat + compteur ops + sous-total monétaire à droite (vert préfixé `+` si crédit > débit, rouge `-` sinon). Clic sur le header → filtre direct sur cette sous-cat (alternative au clic sur la card du haut).
    - Liste des ops du groupe avec bordures bottom subtiles entre lignes pour la lisibilité.
  - Quand un filtre est actif → bascule en vue à plat (la sous-cat est déjà connue, pas besoin du groupage redondant). Header de la section change : « Opérations filtrées (N) » + pill primary affichant le nom de la sous-cat. Empty state contextuel : « Aucune opération pour cette sous-catégorie ».

- **Footer adaptatif au filtre**
  - Le footer Total bascule libellé en « Sous-total » quand un filtre est actif, ajoute la mention « · filtre actif » non-italique, et utilise `footerTotals` (recalculé sur `filteredOps`) au lieu de `data.total_debit`/`data.total_credit` (totaux backend, période complète).

### Added (2026-04-29) — Snapshot PDF du drawer Compta Analytique vers la GED

Bouton 📷 dans le header du `CategoryDetailDrawer` qui capture le contenu visuel du drawer en PNG (via `html-to-image` côté client) et l'envoie au backend qui l'enrobe dans un PDF A4 1-page enregistré dans la GED comme rapport standard. Permet de figer une analyse à un instant T (état des sous-cats, sous-totaux, ops filtrées, footer) pour archive ou envoi comptable.

- **Dépendance frontend**
  - **`frontend/package.json`** — ajout `html-to-image@^1.11.13` (~25 KB minified). Choix vs `html2canvas` : meilleure compatibilité avec les CSS variables Tailwind v4 et meilleure gestion du `position: fixed` quand correctement appliqué (cf. fix ci-dessous).

- **Backend — service nouveau**
  - **[`backend/services/category_snapshot_service.py`](backend/services/category_snapshot_service.py)** *(nouveau)* — helper `export_category_snapshot(png_bytes, category, year, month, quarter, title?) -> dict`. (a) Helper `_slugify(value)` (normalize NFKD + retire diacritiques + replace non-alnum par underscore). (b) Helper `_format_period_label(year, month, quarter)` retourne `"Mois Année" | "T{q} Année" | "Année {y}"`. (c) Lecture des dimensions PNG via Pillow (`PILImage.open(BytesIO(png_bytes))`), validation `> 0`. (d) Calcul des dimensions cible préservant le ratio dans `170mm × 240mm` utiles : si `img_ratio >= max_ratio` borne par largeur, sinon par hauteur. (e) ReportLab `SimpleDocTemplate` A4 portrait (marges 20/15/12mm) avec story = `[Paragraph(titre, style violet #3C3489), Paragraph(meta date+module, style gris), RLImage(BytesIO(png_bytes), width, height), Spacer, Paragraph(footer, style gris centré)]`. (f) Filename : `snapshot_{slug-cat}_{year}-{MM ou T?}_{ts}.pdf` avec timestamp pour permettre plusieurs snapshots successifs sans dédup agressive. (g) `ged_service.register_rapport()` avec filters `{year, month, quarter, categories: [cat]}` et `format_type: "pdf"` ; ENRICHISSEMENT post-register de `rapport_meta` avec `report_type: "snapshot_categorie"`, `source_module: "compta-analytique"`, `snapshot_period: period_label`. Retour `{filename, path, doc_id, title, period_label, size_bytes}`.

- **Backend — endpoint**
  - **[`backend/routers/analytics.py`](backend/routers/analytics.py)** — `POST /api/analytics/category-detail/export-snapshot` (multipart) après le GET existant `/category-detail`. Accepte : `image: UploadFile` + form fields `category: str`, `year: Optional[int]`, `month: Optional[int]`, `quarter: Optional[int]`, `title: Optional[str]`. Validation : content-type prefix `image/`, taille minimale 100 octets, magic bytes `\x89PNG`. 400 si `ValueError` du service, 500 si erreur générique. Délègue à `category_snapshot_service.export_category_snapshot`.

- **Frontend — hook**
  - **[`frontend/src/hooks/useApi.ts`](frontend/src/hooks/useApi.ts)** — `useExportCategorySnapshot()` (mutation TanStack) + type `CategorySnapshotResult` exporté. `mutationFn` construit FormData (`image` + champs métadonnées) et POST direct via `fetch` (pas `api.post` car multipart). Invalidations onSuccess : `['ged-documents']`, `['ged-tree']`, `['ged-stats']` (le snapshot apparaît immédiatement dans la GED).

- **Frontend — drawer**
  - **[`frontend/src/components/compta-analytique/CategoryDetailDrawer.tsx`](frontend/src/components/compta-analytique/CategoryDetailDrawer.tsx)** — bouton `Camera` dans le header (à gauche du `X`). Ref `captureRef` placé sur un **wrapper interne non-fixed** (`<div ref={captureRef} className="flex flex-col h-full bg-background">`) à l'intérieur du drawer outer fixed. **Critique** : initialement appliqué sur le outer `position: fixed` translateX → html-to-image clonait l'élément mais le clone héritait du fixed/transform et se rendait hors-canvas → résultat noir uniforme (PNG entièrement à `backgroundColor: '#0f172a'`). Restructuration en wrapper interne en flow normal résout le problème.
  - Handler `handleExportSnapshot` : (a) capture du contenu COMPLET (pas seulement viewport visible) en étirant temporairement le wrapper en `height: auto` et en basculant la zone scrollable interne `.overflow-y-auto` en `overflow: visible` ; try/finally garantit la restauration des styles (utilisateur voit un flash de ~50ms imperceptible). (b) `toPng(node, { pixelRatio: 2, backgroundColor: '#0f172a', width: fullWidth, height: fullHeight, style: { transform: 'none', position: 'static' }, filter: skip nodes with data-snapshot-skip='true' })` — overrides de style explicites pour neutraliser les contraintes flex/transform du parent. (c) PNG → Blob via `fetch(dataUrl).blob()` → `useExportCategorySnapshot.mutateAsync`. Toast cliquable « Snapshot exporté dans la GED · Voir → » qui navigate vers `/ged?type=rapport&search={filename}`. Marqueur `data-snapshot-skip="true"` sur le groupe de boutons header (Camera + X) pour les exclure du PNG final tout en gardant le titre et les totaux résumé du header.

### Added (2026-04-28) — HomePage NeuronXcompta (vraie page d'accueil chaleureuse)

Nouvelle page racine `/` qui répond à *« que dois-je faire maintenant ? »* — distincte du Dashboard rétrospectif et du Pipeline procédural. Aurora signature en arrière-plan, logo lockup avec chorégraphie spectaculaire (halo + double shimmer), `NextActionCard` qui calcule l'action prioritaire via 5 règles ordonnées, 3 PulseCards (mois en cours / prochaine échéance / alertes actives), 5 QuickActions vers les pages les plus utilisées. **Aucun nouvel endpoint backend** — tout vient des hooks existants. Le Pipeline migre vers `/pipeline`.

- **Backend**
  - **`backend/main.py`** — ajout `app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")` pour servir le logo `logo_lockup_dark_400.png` (déjà présent dans `backend/assets/`). Aucun nouvel endpoint applicatif.

- **Frontend — composants nouveaux** ([`frontend/src/components/home/`](frontend/src/components/home/))
  - **`HomePage.tsx`** — orchestre les sections, gère l'année via `useFiscalYearStore`. Layout : `position: relative; overflow: hidden` avec `AuroraBackground` z-0 et `<main>` z-10 (max-w-6xl).
  - **`LogoLockup.tsx`** — logo 64px avec **chorégraphie 5 phases** : (1) `nx-logo-enter` 300ms (opacity + scale 0.96→1), (2) `nx-halo-burst` 1100ms à t=100ms (halo violet `radial-gradient` qui éclate derrière le logo, scale 0.55→1.45 + opacity peak 0.85), (3) `nx-shimmer` 1100ms à t=400ms (sweep diagonal blanc gauche→droite, gradient 105°), (4) `nx-shimmer-back` 900ms à t=1350ms (sweep miroir droite→gauche, gradient 255°), (5) `nx-halo-breathe` ∞ à t=1500ms (halo subtil qui respire opacity 0.18↔0.34 / scale 1↔1.05 sur 4500ms). Halos en `position: absolute` SOEURS du wrapper masqué (z-index 0, peuvent déborder de la silhouette) ; shimmers à l'intérieur du wrapper masqué (clippés à la silhouette via `mask-image`). Fallback texte stylisé `<onError>` si le PNG ne charge pas.
  - **`AuroraBackground.tsx`** — 3 blobs `radial-gradient` à très faible opacité dérivant lentement (animations `nx-aurora-1/2/3` sur 24/28/32s alternate). Couleurs signature hardcodées (violet `rgba(127,119,221,0.32)` / emerald `rgba(93,202,165,0.20)` / amber `rgba(239,159,39,0.16)`). Pas de `filter: blur()` — la diffusion vient du gradient. `pointer-events: none` + `z-index: 0`.
  - **`HeroBlock.tsx`** — greeting contextuel selon `Date.getHours()` (4 paliers : Bonne nuit / Bonjour / Bon après-midi / Bonsoir), date longue FR via `formatDateLong()` (32px), phrase rotative italique parmi 6 (cross-fade 350ms toutes les 4500ms via `setInterval` + cleanup). Phrase #4 utilise `new Date().getFullYear()` pour rester à jour.
  - **`NextActionCard.tsx`** — card large avec border primary, icône Lucide à gauche (mapping `iconName: 'Clock' | 'Tags' | 'Paperclip' | 'CheckCircle2' | 'Sparkles'`), CTA `navigate(ctaPath)`. Animation `nx-slide-up` 450ms + `nx-home-pulse` infini scale 1↔1.013 (3.2s) qui démarre **après** l'entrée via `animation-delay: 2600ms`.
  - **`PulseCard.tsx`** — composant générique avec 3 variants (`ring` | `value` | `dot`) discriminés par union typée. Variant `ring` : SVG 92×92 avec `r=40`, `stroke-width=6`, draw via `nx-draw-ring` 1300ms (`stroke-dashoffset` de 251.33 → `var(--ring-target)` injecté inline). Variant `value` : grand chiffre + sous-titre (ex. `J–N` + nom échéance). Variant `dot` : dot pulse `nx-dot` 2s + grand chiffre + libellé sévérité. Tous les compteurs via `useCountUp` (rAF, easing easeOutCubic, retourne toujours des entiers via `Math.round` — pas de glitch `71.99999`).
  - **`QuickActions.tsx`** — 5 boutons en grid `1fr × 5` gap 10px (Importer/OCR/Éditeur/Justificatifs/Rapprocher), navigation directe via `useNavigate`. Stagger d'entrée 50ms entre chaque (t=1600 → 1800). Hover : `bg-primary/10`, `border-primary/30`, `translateY(-2px)`, icône `text-primary-light`.

- **Frontend — hooks nouveaux** ([`frontend/src/hooks/`](frontend/src/hooks/))
  - **`useCountUp.ts`** — compteur animé via `requestAnimationFrame` avec cleanup propre à l'unmount (clearTimeout + cancelAnimationFrame). Retourne toujours un entier (`Math.round`) pour éviter les glitchs float. Easing easeOutCubic. Props : `from?`, `to`, `duration?`, `delay?`, `enabled?`.
  - **`useHomeData.ts`** — agrège les data des 3 PulseCards depuis `useAnnualStatus(year)` (taux mois courant) + `useEcheances(year, 'attendu')` (prochaine échéance triée par date) + `useAlertesSummary()` (count + sévérité). Helper `deriveSeverity()` calcule `'critique' | 'moyenne' | 'faible'` depuis `summary.par_type` (doublon/montant à vérifier → critique, ≥5 justif manquants ou à catégoriser → moyenne, sinon faible). Helper `daysUntil(dateStr)` pour le calcul `J–N`.
  - **`useNextAction.ts`** — calcule la `NextActionData` via 5 règles ordonnées (premier match gagne) : (1) échéance fiscale ≤ 7j depuis `useEcheances` (statut 'attendu', `daysUntil(date_attendue) <= 7`), (2) > 5 ops sans catégorie depuis `useOperations(currentMonthFile)` filtré `Catégorie ∈ ['', 'Autres']`, (3) > 3 justificatifs orphelins depuis `useAnnualStatus.nb_justificatifs_total - nb_justificatifs_ok`, (4) mois N-1 ≥ 95% complétion ET non clôturé via `previousAnnualStatus` (gère le wrap décembre/janvier avec décrémentation année), (5) idle "Bel ouvrage / Tout est à jour" → `/pipeline`. Le fichier d'opérations du mois courant est résolu via `useOperationFiles().find(f => f.year === selectedYear && f.month === currentMonth)`.

- **Frontend — types ajoutés** ([`frontend/src/types/index.ts`](frontend/src/types/index.ts))
  - `NextActionKind = 'echeance' | 'uncategorized' | 'orphan_justif' | 'cloture_ready' | 'idle'`
  - `NextActionData { kind, iconName, label, title, subtitle, ctaText, ctaPath }`
  - `AlerteSeverity = 'faible' | 'moyenne' | 'critique'`
  - `PulseCardData { monthLabel, monthCompletion, nextEcheanceDays, nextEcheanceName, alertesCount, alertesSeverity }`
  - `HomeData { pulse, isLoading }`

- **Frontend — utils ajoutés** ([`frontend/src/lib/utils.ts`](frontend/src/lib/utils.ts))
  - `joursFr` — array `['dimanche', ..., 'samedi']` (index 0 = dimanche, cohérent avec `Date.getDay()`).
  - `getGreeting(date?)` — 4 paliers selon `getHours()` : `<5h` Bonne nuit / `<12h` Bonjour / `<18h` Bon après-midi / `≥18h` Bonsoir.
  - `formatDateLong(date?)` — retourne `"mardi 28 avril 2026"` (lowercase mois).

- **Frontend — keyframes ajoutés** ([`frontend/src/index.css`](frontend/src/index.css))
  - 11 keyframes `nx-*` : `nx-fade`, `nx-fade-up`, `nx-slide-up`, `nx-home-pulse`, `nx-draw-ring`, `nx-aurora-1/2/3`, `nx-dot`, `nx-logo-enter`, `nx-shimmer`, `nx-shimmer-back`, `nx-halo-burst`, `nx-halo-breathe`. Préfixe `nx-*` pour éviter collision avec les keyframes existants (`logo-breathe`, `electric-spark`, `scan-sweep`, etc.). `nx-draw-ring` utilise une CSS var `--ring-target` injectée inline sur le SVG path pour permettre la valeur cible dynamique selon `taux_global`.

- **Frontend — wiring** ([`frontend/src/App.tsx`](frontend/src/App.tsx), [`Sidebar.tsx`](frontend/src/components/layout/Sidebar.tsx), [`AppLayout.tsx`](frontend/src/components/layout/AppLayout.tsx))
  - `App.tsx` — route `/` rend désormais `<HomePage />` (au lieu du redirect vers `/dashboard`). `/pipeline` et `/dashboard` inchangés.
  - `Sidebar.tsx` — nouvel item `Accueil` en TOUT premier hors-groupe (icône `Sparkles` violet, `<NavLink to="/" end>` pour ne pas matcher `/pipeline`). Pipeline et Envoi comptable restent juste après.
  - `AppLayout.tsx` — `ROUTE_TITLES['/']` passe de `'Tableau de bord'` à `'Accueil'` → onglet navigateur affiche `Accueil · NeuronXcompta`.

- **Vite proxy** ([`frontend/vite.config.ts`](frontend/vite.config.ts)) — ajout entrée `'/assets': { target: apiTarget, changeOrigin: true }` pour transmettre `/assets/*` du dev server (5173) vers le backend (8000).

**Notes / suites** :
- Le mount `/assets` côté FastAPI **collisionnera** avec `frontend/dist/assets/` au build prod (Vite output ses bundles JS/CSS dans `assets/` par défaut). À traiter au moment du déploiement prod : soit renommer le mount en `/static-assets/`, soit configurer Vite avec `build.assetsDir = '_app'`.
- L'algo NextAction utilise `useFiscalYearStore.selectedYear` pour cohérence avec le reste de l'app (mais le mois reste toujours le mois courant calendaire). La phrase rotative #4 utilise explicitement `new Date().getFullYear()` comme spécifié dans le prompt source.

### Added (2026-04-27) — Mode Envoi Manuel (drawer Envoi Comptable)

Fallback drawer SMTP : quand Gmail bloque le ZIP (`UnsolicitedMessageError`, anti-spam, taille), un nouveau bouton secondaire « Préparer envoi manuel » génère le ZIP sur disque, copie le corps du mail dans le presse-papier, ouvre Finder sur le fichier et lance `mailto:` avec l'objet pré-rempli. Le comptable n'accède jamais au LAN — l'utilisateur joint lui-même le ZIP depuis son client mail. Indépendance totale du SMTP : aucun app password Gmail requis pour le mode manuel.

- **Backend**
  - **Modèles** [`backend/models/email.py`](backend/models/email.py) — `EmailMode = Literal["smtp", "manual"]`, nouveaux `ManualPrep` (id court via `secrets.token_urlsafe(8)`, `zip_filename`, `zip_path`, `taille_mo`, `contenu_tree`, `documents`, `objet`, `corps_plain`, `destinataires`, `prepared_at`, `sent`) + `ManualPrepRequest`. Champ `mode: EmailMode = "smtp"` ajouté à `EmailHistoryEntry` (rétrocompat : entrées historiques sans champ → traitées comme `smtp`).
  - **Service** [`backend/services/email_service.py`](backend/services/email_service.py) — répertoire persistant `MANUAL_ZIPS_DIR = data/exports/manual/` + index `_index.json` (écriture atomique via `tempfile.mkstemp` + `os.replace`). Fonctions :
    - `prepare_manual_zip(req)` — résout les chemins via `_resolve_document_path` (réutilise le résolveur SMTP), crée le ZIP via `_create_manual_zip` (réutilise `TYPE_FOLDER_MAP` pour grouper exports/rapports/releves/justificatifs/documents/), génère objet/corps via `generate_email_subject` + `generate_email_body_plain` si non fournis, indexe l'entrée. Filename : `Documents_Comptables_{YYYY-MM}_{YYYY-MM-DD_HH-MM}.zip` (période détectée via `_resolve_single_period` partagée avec le module Check d'envoi) ou `Documents_Comptables_{YYYY-MM-DD_HH-MM}.zip` si multi-périodes. Anti-collision incrémentale `_2`/`_3`.
    - `list_manual_zips()` — filtre `sent=False`, vérifie existence physique du ZIP, auto-purge silencieuse des entrées orphelines, tri `prepared_at` desc.
    - `get_manual_zip(zip_id)` / `delete_manual_zip(zip_id)` — lookup + suppression PDF physique + entrée index.
    - `open_manual_zip_in_finder(zip_id)` — `subprocess.Popen(["open", "-R", zip_path])` (révèle dans Finder, ne déballe pas).
    - `mark_manual_zip_sent(zip_id)` — crée `EmailHistoryEntry { mode: "manual", success: true }` via `email_history_service.log_send`, **supprime le ZIP physique** (libère le disque, mail déjà parti) tout en gardant l'entrée d'index `sent=True` comme piste d'audit (`sent_count` reste exact).
    - `cleanup_old_manual_zips(max_age_days=30)` — supprime ZIPs `sent=False` dont `prepared_at < now - max_age_days`. `max_age_days=0` purge tout (utilisé par bouton « Vider »).
    - `get_manual_zips_stats()` — `{pending_count, pending_size_bytes, pending_size_mo, sent_count}` pour le compteur Settings.
    - Helper `ensure_manual_dirs()` exposé pour le boot.
  - **Router** [`backend/routers/email.py`](backend/routers/email.py) — 7 endpoints sous `/api/email` : `POST /prepare-manual` (400 si liste vide), `GET /manual-zips`, **`POST /manual-zips/cleanup?max_age_days=`** (déclaré AVANT `/{zip_id}` pour éviter ambiguïté FastAPI), **`GET /manual-zips/stats`** (idem), `POST /manual-zips/{id}/open-native`, `POST /manual-zips/{id}/mark-sent`, `DELETE /manual-zips/{id}`.
  - **Coverage** [`backend/services/email_history_service.py:63`](backend/services/email_history_service.py:63) — `get_send_coverage(year)` filtre désormais `mode in ("smtp", "manual")` ET `success=True` : un mois marqué envoyé manuellement compte exactement comme un envoi SMTP réussi pour la couverture mensuelle. Mode absent (legacy) → traité comme `smtp` pour rétrocompat.
  - **Lifespan** [`backend/main.py`](backend/main.py) — appel `email_service.ensure_manual_dirs()` au boot (idempotent) + nouvelle boucle asyncio `_manual_zips_cleanup_loop()` qui appelle `cleanup_old_manual_zips(30)` toutes les 24h. **Pattern coopératif strict via `shutdown_event`** (cf. CLAUDE.md, `await asyncio.wait_for(shutdown_event.wait(), timeout=N)`, **jamais** `while True: await asyncio.sleep(N)` nu) — pas d'APScheduler, alignement avec les 3 autres loops du projet (`_previsionnel_*`, `_check_envoi_*`, `_sandbox_auto_*`). Délai de démarrage 5min puis tick 24h, ajoutée au cancel batch shutdown.

- **Frontend**
  - **Types** [`frontend/src/types/index.ts`](frontend/src/types/index.ts) — `EmailMode`, `ManualPrep`, `ManualPrepRequest`, `ManualZipsStats`, champ `mode?: EmailMode` sur `EmailHistoryEntry`.
  - **Hooks** [`frontend/src/hooks/useEmail.ts`](frontend/src/hooks/useEmail.ts) — 7 hooks TanStack : `useManualZips`, `useManualZipsStats`, `usePrepareManual`, `useOpenManualInFinder`, `useMarkManualSent`, `useDeleteManualZip`, `useCleanupManualZips`. Invalidations correctes : `email-manual-zips`, `email-manual-zips-stats`, `email-history` (sur mark-sent qui crée une entrée historique).
  - **Composants** :
    - [`frontend/src/components/email/ManualSendButton.tsx`](frontend/src/components/email/ManualSendButton.tsx) — bouton secondaire pleine largeur (icône `FolderDown`, fond `bg-surface-hover`). Au clic : (1) validation docs/destinataires non vides, (2) `prepareManual.mutateAsync`, (3) `navigator.clipboard.writeText(corps_plain)` (échec silencieux si permission refusée), (4) `openInFinder.mutateAsync(id)`, (5) `window.location.href = mailto:dest?subject=...` (objet uniquement, le corps **ne passe PAS dans `?body=` car limite ~2000 chars + encodage capricieux dans Gmail web — toujours via clipboard**), (6) toast multi-ligne 6s « ✓ ZIP ouvert dans Finder · ✓ Corps du mail copié · Colle-le dans le brouillon (⌘V) ».
    - [`frontend/src/components/email/ManualZipCard.tsx`](frontend/src/components/email/ManualZipCard.tsx) — carte avec 4 actions : `[📂 Finder]` `[📋 Recopier]` (re-copie clipboard + ré-ouvre `mailto:` si l'utilisateur a fermé son brouillon par erreur) `[✓ Envoyé]` (vert emerald) `[🗑]` (avec `window.confirm`). Date relative via `formatDistanceToNow` de `date-fns` avec locale `fr` (« il y a 2h »).
  - **Drawer** [`frontend/src/components/email/SendToAccountantDrawer.tsx`](frontend/src/components/email/SendToAccountantDrawer.tsx) — section ajoutée dans la colonne droite après le size gauge : séparateur `border-t` + label `Si l'envoi automatique échoue :` + `<ManualSendButton>` (passe `documents`/`destinataires`/`objet`/`corps` depuis l'état du drawer, désactivé si vide). Section repliable `<details>` « ZIPs préparés (N) » avec liste de `ManualZipCard` (rendue uniquement si `manualZips.length > 0`, defaultOpen=false).
  - **Settings > Stockage** [`frontend/src/components/settings/SettingsPage.tsx`](frontend/src/components/settings/SettingsPage.tsx) — nouveau composant `ManualZipsStorageSection` après `JustificatifsIntegritySection` : compteur live « N ZIP en attente d'envoi » + taille disque + bouton « Vider les ZIPs préparés » (icône `Trash2` rouge danger) qui appelle `useCleanupManualZips(0)` après `window.confirm`. Bouton désactivé si pending=0.

- **Anti-patterns évités** :
  - ❌ Mélanger la logique manuelle dans `send_email()` : tout passe par `prepare_manual_zip()` séparé.
  - ❌ Réutiliser le ZIP créé par `send_email()` (temporaire et supprimé) : le mode manuel a son propre dossier persistant `data/exports/manual/`.
  - ❌ Mettre le corps dans `mailto:?body=...` : limite ~2000 chars + encodage capricieux dans Gmail web. **Toujours** passer par le clipboard.
  - ❌ `useRef` ou `useEffect` pour déclencher le mailto : `window.location.href` directement dans le `onSuccess` de la mutation.

- **Déviations assumées par rapport au prompt initial** :
  - `ManualPrep` enrichi de `documents: list[DocumentRef]` (le spec l'omettait — nécessaire pour reconstruire `EmailHistoryEntry` lors du `mark-sent` sans reverse-lookup fragile depuis `contenu_tree`).
  - APScheduler remplacé par `asyncio.create_task` coopératif (pattern interne strict, cf. les 3 autres loops du projet).
  - Endpoint `GET /manual-zips/stats` ajouté (non spécifié) pour le compteur Settings (évite de fetcher la liste complète + parser côté client).
  - `mark-sent` supprime le ZIP physique (spec implicite : carte disparaît + disque libéré) — l'entrée d'index reste pour `sent_count` et l'audit.

---

### Added (2026-04-27) — Module Check d'envoi (rituel pré-vol récurrent avant envoi comptable)

Nouveau module `/check-envoi` qui matérialise le rituel de pré-vol mensuel/annuel avant l'envoi du dossier au comptable. Audite l'état de l'app via les services existants (zéro nouvelle source de vérité), permet d'ajouter des commentaires libres injectés ensuite dans le mail, et signale via badge sidebar les mois clôturés non encore validés (niveaux N1 J+10 / N2 J+15 / N3 J+20). **Décision UX : sidebar uniquement** — pas de toast intrusif, pas de bannière sticky dans le drawer Email, pas de widget Dashboard. **Page d'accueil** `/` migrée de Pipeline → Dashboard ; Pipeline reste accessible via `/pipeline`.

- **Backend**
  - **Modèles** [`backend/models/check_envoi.py`](backend/models/check_envoi.py) — 3 enums (`CheckSource`, `CheckStatus`, `CheckPeriod`) + 5 BaseModel (`CheckEnvoiItem`, `CheckEnvoiSection`, `CheckEnvoiInstance`, `ReminderState`, body PATCH/snooze/dismiss).
  - **Service** [`backend/services/check_envoi_service.py`](backend/services/check_envoi_service.py) — catalogue statique 8 sections × 2 vues (mensuelle + annuelle), ~36 items. Évaluateurs auto branchés sur services existants : `operation_service`, `cloture_service`, `analytics_service`, `bnc_service`, `liasse_scp_service`, `ged_service`, `charges_forfaitaires_service`, `amortissement_service`, `previsionnel_service`, `justificatif_service`, `alerte_export_service`, `ocr_service`, `rename_service`, `export_service`. **Items auto recalculés à chaque GET, jamais persistés sur disque** (sauf via cache mtime des services consommés). Seuls `comment`, `validated_at`, et le statut des items `manual` sont persistés. Compte d'attente : un sous-item bloquant dynamique par op sans commentaire (key `compte_attente.vide_ou_commente.{md5(filename+date+libelle+debit+credit)[:12]}`, `requires_comment=True`, statut `BLOCKING → MANUAL_OK` dès saisie). Commentaire propagé vers `op.compte_attente_commentaire` pour l'export CSV. Helpers `_compute_level(period_key, now, settings)` (1/2/3 selon delta jours, respecte `settings.check_envoi_vacances_jusquau`), `get_active_reminder()`, `daily_recompute_reminders()`.
  - **Router** [`backend/routers/check_envoi.py`](backend/routers/check_envoi.py) — 9 endpoints sous `/api/check-envoi` : `GET /{year}/{period}`, `GET /{year}/coverage`, `PATCH /{year}/{period}/items/{item_key}` (body `{comment?, manual_ok?}`), `POST /{year}/{period}/validate` (HTTP 400 si bloquants restants), `POST /{year}/{period}/unvalidate`, `GET /notes/{year}/{month}`, `GET /reminders/state`, `POST /reminders/snooze`, `POST /reminders/dismiss`.
  - **Stockage** : `data/check_envoi/{year}.json` (clés `"01"`–`"12"` + `"annual"`, une instance par clé), `data/check_envoi/reminders.json` (`{period_key: ReminderState}`). Dir créé au boot via `ensure_directories()` ([`backend/core/config.py`](backend/core/config.py:55) `CHECK_ENVOI_DIR`).
  - **Settings** [`backend/models/settings.py`](backend/models/settings.py) — 4 nouveaux champs : `check_envoi_reminder_n1_offset` (10), `check_envoi_reminder_n2_offset` (15), `check_envoi_reminder_n3_offset` (20), `check_envoi_vacances_jusquau` (Optional ISO date — pendant cette fenêtre, `_compute_level` retourne None).
  - **Scheduler** [`backend/main.py`](backend/main.py) — nouvelle boucle asyncio `_check_envoi_reminder_loop()` qui appelle `check_envoi_service.daily_recompute_reminders()` toutes les heures. Pattern coopératif strict via `shutdown_event` (cf. CLAUDE.md, `await asyncio.wait_for(shutdown_event.wait(), timeout=N)`, **jamais** `while True: await asyncio.sleep(N)` nu). Démarrée dans `lifespan()` à côté de `_prev_task` ; ajoutée au cancel batch shutdown.
  - **Email** [`backend/services/email_service.py`](backend/services/email_service.py) — helpers `_resolve_single_period(documents)` et `_check_envoi_notes_block(documents)` qui détectent une période unique parmi les documents sélectionnés et appellent `check_envoi_service.get_notes_for_email(year, month)`. Injection en plain text (avant signature) ET en HTML via nouveau placeholder `{notes_section}` dans [`backend/templates/email_template.html`](backend/templates/email_template.html) (bloc encadré violet `border-left: 3px solid #534AB7`). Multi-périodes → pas d'injection (l'utilisateur peut le faire à la main). Format : `- {Section.label} / {item.label} : {comment}` une ligne par commentaire non vide.

- **Frontend**
  - **Types** [`frontend/src/types/index.ts`](frontend/src/types/index.ts) — 7 types : `CheckSource`, `CheckStatus`, `CheckPeriod`, `CheckEnvoiItem`, `CheckEnvoiSection`, `CheckEnvoiInstance`, `CheckCoverage`, `CheckReminderState`.
  - **Hooks** [`frontend/src/hooks/useCheckEnvoi.ts`](frontend/src/hooks/useCheckEnvoi.ts) — 9 hooks TanStack Query : `useCheckInstance`, `useCheckCoverage`, `useUpdateCheckItem`, `useValidateCheck` (invalide en plus `['cloture', year]`), `useUnvalidateCheck`, `useCheckReminderState`, `useSnoozeReminder`, `useDismissReminder`, `useCheckNotesForEmail`. Toutes les mutations invalident `['check-envoi']` + `['check-coverage']`.
  - **Composants** `frontend/src/components/check-envoi/` (5 fichiers) :
    - [`CheckEnvoiPage.tsx`](frontend/src/components/check-envoi/CheckEnvoiPage.tsx) — header (titre + sous-titre coloré J+N depuis `useCheckReminderState` + toggle Mois/Année), bannière warning souple si `!ready_for_send`, 4 MetricCards (`ok`/`warning`/`blocking`/`pending`), 8 sections, footer sticky avec boutons « Valider » / « Préparer l'envoi → ». Ouvre le drawer email via `useSendDrawerStore.open({defaultSubject})`.
    - [`CheckSection.tsx`](frontend/src/components/check-envoi/CheckSection.tsx) — accordéon avec pastille statut résumée (priorité bloquant > warning > pending > OK).
    - [`CheckItem.tsx`](frontend/src/components/check-envoi/CheckItem.tsx) — icônes Lucide (`Check`/`AlertTriangle`/`SquareCheck`/`OctagonX`/`Circle`), bouton « + Note » → « Note ✓ » violet, items `manual` → checkbox toggle, items `requires_comment` → bloc rouge inline avec textarea.
    - [`CommentBox.tsx`](frontend/src/components/check-envoi/CommentBox.tsx) — textarea debounce 500ms, mode preview *« Visible dans l'email : "{comment}" »*.
    - [`MonthYearToggle.tsx`](frontend/src/components/check-envoi/MonthYearToggle.tsx) — pill segmented control + sélecteur mois compact.
  - **Sidebar** [`frontend/src/components/layout/Sidebar.tsx`](frontend/src/components/layout/Sidebar.tsx) — item `/check-envoi` (icône `ClipboardCheck`) ajouté en dernier dans le groupe **CLÔTURE** (juste avant l'item Envoi comptable du standalone top). Pipeline NavLink repointé de `/` vers `/pipeline`. Nouveau composant [`CheckEnvoiBadge.tsx`](frontend/src/components/layout/CheckEnvoiBadge.tsx) : badge coloré dynamique selon `useCheckReminderState` (rouge N3, orange N2, amber N1, vert si tous mois clôturés validés, rien sinon).
  - **Routes** [`frontend/src/App.tsx`](frontend/src/App.tsx) — `/` → `<Navigate to="/dashboard" replace />`, `/pipeline` → `PipelinePage`, `/check-envoi` → `CheckEnvoiPage`. Dashboard reste sur `/dashboard`.
  - **AppLayout** [`frontend/src/components/layout/AppLayout.tsx`](frontend/src/components/layout/AppLayout.tsx) — `ROUTE_TITLES` mis à jour (`/` = "Tableau de bord", `/pipeline` = "Pipeline", `/check-envoi` = "Check d'envoi", `/snapshots` = "Snapshots").

- **Décisions UX appliquées** (différences par rapport au prompt initial) :
  - **Sidebar uniquement** : pas de `CheckReminderToast` global dans `AppLayout`, pas de bannière warning sticky dans le drawer Email Comptable, pas de widget Dashboard. Le badge sidebar suffit pour signaler les reminders.
  - **Injection des notes dans le mail conservée** (texte + HTML) — utile pour le comptable, indépendamment de la décision sidebar-only.
  - **Page d'accueil migrée** : `/` → Dashboard (le Pipeline reste accessible via `/pipeline`).

---

### Added (2026-04-27) — Prompt B3 : Amortissements templates Rapports V2 (anti-duplication)

**Unification des sources de rapports amortissements** via 2 nouveaux templates dans `report_service.REPORT_TEMPLATES` avec dédup stricte par filtres. L'OD dotation (B1), l'export ZIP et l'UI Rapports V2 convergent désormais pour consommer ces templates au lieu de regénérer en parallèle. Triple bénéfice : (a) zéro duplication (1 PDF, 1 entrée GED, 1 fichier disque par couple `(filters, format)`), (b) accès à un PDF/CSV/XLSX à la demande sans passer par l'OD, (c) format unifié OCR↔ZIP↔UI.

- **Refactor [`backend/services/amortissement_report_service.py`](backend/services/amortissement_report_service.py)** : passe de « 1 fonction monolithique PDF » à « 2 renderers multi-format ». Nouvelles fonctions publiques :
  - `render_registre(year, output_path, format, filters)` — registre complet (actives + amorties + sorties). Filtres : `year`, `statut` (all/en_cours/amorti/sorti), `poste` (all/<poste>). Dispatch sur `_render_registre_pdf/csv/xlsx`.
  - `render_dotations(year, output_path, format, filters)` — tableau dotations exercice. Filtres : `year`, `poste`. Dispatch sur `_render_dotations_pdf/csv/xlsx`.
  - **Colonne `Origine`** ajoutée dans les 6 sorties (`NeuronX` ou `Reprise {exercice_entree_neuronx}`) — badge ambre `#FAEEDA`/`#854F0B` pour les immos en reprise (style cohérent avec le badge frontend `Reprise {year}`).
  - PDF : ReportLab paysage A4, logo, titre + sous-filtres, tableau coloré, ligne TOTAL violette `#EEEDFE`, référence légale art. 39-1-2° CGI / PCG 214-13.
  - CSV : BOM UTF-8, séparateur `;`, virgule décimale, CRLF (Excel FR). 12 colonnes registre / 12 colonnes dotations + ligne TOTAL.
  - XLSX : openpyxl avec header violet `#3C3489`, format `#,##0.00 €` sur colonnes monétaires, formules SUM en pied de tableau, freeze A2, auto-width, fill ambre sur cellule Origine pour les reprises.
  - Tolérant `xlsx`↔`excel` (frontend envoie selon le contexte).
  - **Backward compat B1** : `generate_dotation_pdf(year, output_path)` conservé comme wrapper vers `render_dotations(year, path, "pdf", {"poste": "all"})`.

- **2 nouveaux templates** dans [`backend/services/report_service.py`](backend/services/report_service.py) `REPORT_TEMPLATES` (champs étendus optionnels : `category`, `formats`, `filters_schema`, `renderer`, `dedup_key_fn`, `title_builder`) :
  - **`amortissements_registre`** (icône `Package`, catégorie `Amortissements`) — `dedup_key: amort_registre_{year}_{statut}_{poste}`.
  - **`amortissements_dotations`** (icône `TrendingDown`, catégorie `Amortissements`) — `dedup_key: amort_dotations_{year}_{poste}`.
  - `_ensure_amortissements_renderers()` injection lazy (au premier appel) pour éviter le cycle d'imports `report_service ↔ amortissement_report_service`. Idempotent.
  - `get_templates()` filtre les callables (`renderer`/`dedup_key_fn`/`title_builder`) avant exposition API via whitelist `_TEMPLATE_PUBLIC_KEYS` — les 5 templates restent JSON-sérialisables pour `/api/reports/templates`.

- **Helper `report_service.get_or_generate(template_id, filters, format, title?, description?)`** :
  - Recherche un rapport existant via `dedup_key_fn(filters)` + format dans `reports_index.json`. Cache hit (fichier disque OK) → retourne `{from_cache: True, ...}` sans regénération.
  - Cache miss → archive l'ancien (si présent), exécute `template["renderer"](year, output_path, format, filters)`, indexe avec `dedup_key`, register en GED via `ged_service.register_rapport`. Retourne `{from_cache: False, replaced: <ancien|null>, ...}`.
  - `dedup_key` stocké dans chaque entrée `reports_index.json` aux côtés du `format` pour matching O(N).
  - `generate_report()` dispatche automatiquement vers `get_or_generate` quand `template_id` correspond à un template avec `renderer` (pas d'infinite loop : le legacy path n'appelle jamais `get_or_generate` sur ses propres templates).
  - Templates standards (BNC annuel, Ventilation charges, Récap social) restent inchangés (pas de `renderer` → legacy path).

- **Convergence OD dotation → template** ([`amortissement_service.generer_dotation_ecriture`](backend/services/amortissement_service.py)) :
  - Consomme désormais `report_service.get_or_generate(template_id="amortissements_dotations", filters={year, poste: "all"}, format="pdf")` au lieu d'appeler directement `generate_dotation_pdf()`.
  - L'OD pointe vers `report.filename`. Après `get_or_generate` (qui register_rapport en GED standard), `_register_dotation_ged_entry()` est rappelé pour **enrichir** la metadata GED avec `operation_ref`, `source_module: "amortissements"` et `rapport_meta` (overwrite la version générique pour permettre la navigation `/amortissements?tab=dotation`).
  - **`supprimer_dotation_ecriture(year)` PRÉSERVE désormais le PDF** (il vit sa vie dans Rapports V2). Retourne `{status, year, filename, index, pdf_preserved: True}`. Suppression seulement via la GED ou via régénération du template.
  - **`regenerer_pdf_dotation(year)`** passe par `get_or_generate` (force-régen via suppression du fichier disque pour forcer une nouvelle archive), met à jour le `Lien justificatif` de l'OD si le filename change, invalide le thumbnail GED.

- **Convergence export ZIP → templates** ([`export_service._add_amortissements_to_zip`](backend/services/export_service.py)) :
  - Consomme `report_service.get_or_generate` au lieu de générer dans `/tmp/`. Section `Amortissements/` du ZIP contient désormais 3 fichiers **strictement identiques** à ceux servis via `/reports` et la GED : registre PDF (statut=all, poste=all), registre CSV, tableau dotations PDF (poste=all).
  - Helper interne `_add_template(template_id, filters, fmt, type_label)` factorise la logique. Plus d'écriture dans `/tmp/`, plus de duplication.
  - Helper legacy `_generate_registre_amortissement_csv` supprimé (le rendu CSV est maintenant fait par le renderer du template).

- **Helper `amortissement_service.list_immobilisations_enriched(year)`** : retourne TOUTES les immos enrichies (`vnc_actuelle`, `avancement_pct`). Le param `year` est ignoré pour la liste (le registre couvre l'ensemble) et conservé pour la cohérence des templates Rapports V2. Wrapper de `get_all_immobilisations(statut=None, poste=None, year=None)`.

- **UI Rapports V2** ([`ReportFilters.tsx`](frontend/src/components/reports/ReportFilters.tsx) + [`ReportsPage.tsx`](frontend/src/components/reports/ReportsPage.tsx)) :
  - **Templates groupés par catégorie** : section `TEMPLATES RAPIDES` (standards) puis `TEMPLATES RAPIDES · AMORTISSEMENTS` (les 2 nouveaux). Ring primary autour du template card sélectionné.
  - **Filtres conditionnels** : quand un template `category === 'Amortissements'` est sélectionné — (a) bloc « Filtres amortissements » (fond `bg-primary/5 border-primary/20`) avec dropdown Statut (Registre uniquement) + dropdown Poste (peuplé via `useGedPostes()`) + note dédup ; (b) filtres standards (catégories, sous-cat, type, montant min/max, source) **masqués** ; (c) bouton « Batch (12 mois) » **masqué** (rapport annuel) ; (d) format selector lit `template.formats` (PDF / CSV / **XLSX**) au lieu du défaut PDF/CSV/EXCEL.
  - Types étendus : `ReportFiltersV2.statut?`, `ReportFiltersV2.poste?`, `ReportTemplate.category?` / `formats?` / `filters_schema?`, `ReportGenerateRequest.format` accepte désormais `'xlsx'`.

**Tests end-to-end OK** :
- 6/6 générations multi-format (registre × {pdf,csv,xlsx}, dotations × {pdf,csv,xlsx}) — fichiers 17.2 Ko PDF / 401 o CSV / 5.5 Ko XLSX.
- Dédup vérifiée : cache hit (`from_cache: True`) sur mêmes filtres ; nouveau fichier sur filtres différents (statut=en_cours).
- UI live : `POST /api/reports/generate → 200 OK` avec `template_id: "amortissements_dotations"`, `dedup_key: "amort_dotations_2025_all"`, second clic = pas de doublon dans l'index ni sur disque ni dans archives.

### Added (2026-04-27) — Prompt B1 : Amortissements backend écritures (OD + PDF + GED + task + ZIP)

**Matérialisation comptable de la dotation aux amortissements**, pattern strict `charges_forfaitaires_service` (blanchissage / repas / véhicule). L'OD au 31/12 passe la dotation déductible en charge fiscale, avec PDF rapport ReportLab + entrée GED + nettoyage idempotent.

- **Nouveau service** [`backend/services/amortissement_report_service.py`](backend/services/amortissement_report_service.py) : `generate_dotation_pdf(year, output_path) -> Path`. ReportLab A4 portrait : logo `logo_lockup_light_400.png`, titre `État des amortissements — Exercice {year}`, tableau registre 9 colonnes (`Désignation / Acquis le / Durée / Base / VNC début / Dotation / Q-part / VNC fin / Poste`) + ligne TOTAL violet `#EEEDFE`, récapitulatif (dotation brute / déductible / nb immos), référence légale art. 39-1-2° CGI / PCG 214-13. Helpers internes `_fr_euro` (1 234,56 €) et `_format_date_fr` (15/03/2024).

- **4 fonctions publiques** ajoutées dans [`backend/services/amortissement_service.py`](backend/services/amortissement_service.py:929) :
  - **`generer_dotation_ecriture(year)`** — OD 31/12 + PDF + GED. Idempotent : si OD existante (même fichier OU autre fichier post split/merge), supprime + cleanup PDF + GED avant de recréer. OD : `Catégorie: "Dotations aux amortissements"`, `source: "amortissement"`, `locked: true`, `lettre: true`, `type_operation: "OD"`, `Lien justificatif: "reports/{pdf_filename}"`, commentaire `Dotation amortissements exercice {year} — {N} immo(s) — art. 39-1-2° CGI`. Format filename PDF : `amortissements_{YYYY}1231_{int(montant)}.pdf` dans `data/reports/`. Retourne `{status, year, filename, index, pdf_filename, ged_doc_id, montant_deductible, nb_immos}`. Lève `ValueError` si `nb_immos_actives == 0`.
  - **`supprimer_dotation_ecriture(year)`** — Nettoie OD + PDF disque + entrée GED. Retourne `{status: "deleted"|"not_found", year, filename?, index?, pdf_removed?}`.
  - **`regenerer_pdf_dotation(year)`** — Pattern véhicule, regénère uniquement le PDF (l'OD reste en place) + invalide la thumbnail GED via `delete_thumbnail_for_doc_id(doc_id)`. Lève `ValueError` si OD absente. Utile quand le tableau d'amortissement change sans qu'on veuille re-supprimer/re-créer l'OD.
  - **`get_candidate_detail(filename, index)`** — Retourne `{operation, filename, index, justificatif: {filename, ocr_data}|null, ocr_prefill: {designation, date_acquisition, base_amortissable}}` pour `ImmobilisationDrawer` (Prompt B2). Préfill OCR prioritaire (supplier+best_date+best_amount), fallback sur les valeurs de l'op bancaire.
  - Helpers privés : `_find_or_create_december_file(year)` (scan du mois dominant des dates, fallback sur `operation_service.create_empty_file(year, 12)`), `_register_dotation_ged_entry(...)` (pattern direct `load_metadata`/`save_metadata` comme `charges_forfaitaires_service`, pas `register_rapport`), `_remove_dotation_ged_entry(pdf_filename)` (best-effort, log warning sur échec).

- **5 endpoints ajoutés** dans [`backend/routers/amortissements.py`](backend/routers/amortissements.py:81) (sous `/api/amortissements/`) :
  - `POST /generer-dotation?year=X` (400 si pas d'immo)
  - `DELETE /supprimer-dotation?year=X` (idempotent)
  - `POST /regenerer-pdf-dotation?year=X` (404 si OD absente)
  - `GET /candidate-detail?filename=X&index=N` (préfill OCR pour Prompt B2)
  - `GET /dotation-genere?year=X` (métadonnées OD ou `null` — pattern véhicule pour brancher l'UI Prompt B2)

- **Bug fix `find_dotation_operation`** — l'ancienne implémentation filtrait par regex sur le filename (`f"{year}12"` ou `f"_{year}12_"`) ce qui ratait les fichiers post-merge contenant des dates multi-années (ex. `operations_merged_202512_*.json` contenant des ops 2025-11/12 ET 2026-03/12). Corrigé pour scanner le contenu réel : `op.source == "amortissement"` ET `op.Date.startswith(f"{year}-12-")`. Robuste aux fichiers merged/split.

- **7ᵉ détection `dotation_manquante`** dans [`backend/services/task_service.py`](backend/services/task_service.py:158) (insérée avant `ml_retrain` qui passe en 6ᵉ). Déclenche si `(today.year > year OR (today.year == year AND today.month >= 12))` ET `find_dotation_operation(year) is None` ET `nb_immos_actives > 0`. `auto_key: "dotation_manquante_{year}"`, `priority: HIGH`, `metadata: {nb_immos, total_deductible, action_url: "/amortissements?tab=dotation&year={year}"}`. Idempotente via dedup `auto_key` du router : disparaît au prochain refresh dès que l'OD est générée.

- **Section `Amortissements/` dans l'export ZIP** ([`backend/services/export_service.py`](backend/services/export_service.py:996)) :
  - Helper `_add_amortissements_to_zip(zf, year, prefix="")` ajoute (a) le PDF du rapport OD si l'OD a été générée, (b) `registre_immobilisations_{year}.pdf` régénéré à la volée si l'OD est absente, (c) `registre_immobilisations_{year}.csv` (BOM UTF-8, séparateur `;`, virgule décimale, CRLF — Excel FR). No-op si `nb_immos_actives == 0`.
  - Helper `_generate_registre_amortissement_csv(detail)` : 11 colonnes `Désignation;Acquis le;Mode;Durée;Base;VNC début;Dotation brute;Quote-part;Dotation déductible;VNC fin;Poste` + ligne TOTAL.
  - Toggle `include_amortissements: bool = True` sur `GenerateMonthRequest` ([routers/exports.py](backend/routers/exports.py:33)) + `generate_single_export()` — section ajoutée uniquement pour `month == 12` (l'OD est au 31/12). `generate_batch_export()` ajoute la section au root du ZIP si décembre est dans `months[]`. `generate_export()` legacy (`/generate`) **non touché**.

- **Modèle `Operation`** ([models/operation.py:38](backend/models/operation.py:38)) — `source: Optional[str] = None` accepte déjà `"amortissement"` (commentaire confirmé), pas de migration nécessaire.

**Tests end-to-end OK sur 2026** (2 immos, 713 € déductible) : cycle `generer → find → 2ᵉ generer (idempotence : 1 seule OD) → regenerer_pdf → supprimer (OD + PDF + GED nettoyés)` fonctionne. Helper ZIP produit `Amortissements/amortissements_20261231_713.pdf` (17 729 octets) + `registre_immobilisations_2026.csv` (355 octets, ligne TOTAL `;;;;;;713,00;;713,00;;`). Task auto `dotation_manquante_2025` détectée HIGH.

### Added (2026-04-27) — Prompt A2 : Amortissements frontend fiscal (reprise + ligne virtuelle)

- **Migration types `Immobilisation`/`ImmobilisationCreate`** vers les nouveaux noms backend (Prompt A1) : `libelle → designation`, `valeur_origine → base_amortissable`, `duree_amortissement → duree`, `methode → mode`, `poste_comptable → poste`. Ajout des 3 champs reprise (`exercice_entree_neuronx?`, `amortissements_anterieurs`, `vnc_ouverture?`). `LigneAmortissement` enrichi de `is_backfill?`, `libelle?`, `vnc_debut?`. `AmortissementConfig` aligné sur le modèle Pydantic minimaliste (`seuil`, `sous_categories_exclues`, `durees_par_defaut`, `coefficient_degressif`). Moteur TS [`lib/amortissement-engine.ts`](frontend/src/lib/amortissement-engine.ts) : `CalcAmortissementParams` utilise `base_amortissable` + `mode` (au lieu de `valeur_origine` + `methode`).
- **3 nouveaux hooks A2** ([useAmortissements.ts](frontend/src/hooks/useAmortissements.ts)) : `useDotationVirtualDetail(year)` (queryKey `['amortissements', 'virtual-detail', year]`), `useDotationRef(year)` (prépare Prompt B), `useComputeBackfill()` (mutation pour suggestion backfill).
- **`AmortissementsPage` migrée vers `useFiscalYearStore`** (9ᵉ page) : `selectedYear` lu directement du store, propagé dans `useAmortissementKpis(year)` + `useDotationsExercice(year)`. Sélecteur année local supprimé. Badge ambre `Reprise {exercice_entree_neuronx}` à côté du nom dans le tableau Registre (tooltip `Reprise depuis {year} — acquisition réelle {year_acq}`).
- **`ImmobilisationDrawer` — mode `Linéaire` verrouillé** : sélecteur mode remplacé par pavé readonly avec tooltip BNC (`Le dégressif est réservé à la comptabilité d'engagement…`). En création, mode forcé à `lineaire`. En édition d'une immo legacy `degressif`, le label affiche « Dégressif (legacy) » et la valeur est conservée au save (`isEdit ? mode : 'lineaire'`).
- **`ImmobilisationDrawer` — section Reprise d'exercice antérieur** (visible uniquement en création) : checkbox repliée par défaut qui déplie 3 inputs (exercice d'entrée, cumul amortissements antérieurs, VNC d'ouverture). Auto-calcul via `POST /amortissements/compute-backfill` avec debounce 400 ms quand les 4 champs de base changent. Flag `backfillManuallyEdited` bascule à true quand l'utilisateur édite amort/VNC → bouton « Recalculer depuis la durée légale » pour revenir au calcul auto. Validation temps réel : badge vert si `amort + vnc === base` (tolérance 1 €), badge rouge sinon — bouton Enregistrer désactivé si incohérence. Note info bleue expliquant que les exercices antérieurs sont hors scope NeuronX. L'aperçu tableau temps réel est masqué en mode reprise (le tableau définitif sera calculé côté backend avec backfill).
- **`ConfigAmortissementsDrawer` simplifié** : section « Catégories éligibles » supprimée (détection backend strict `Catégorie == "Matériel"`). Note info bleue au-dessus du seuil expliquant que les autres catégories restent immobilisables manuellement. Sections conservées : seuil, sous-catégories exclues (chips supprimables), durées par défaut, plafonds véhicules CO2 (read-only).
- **`DotationsVirtualDrawer`** ([components/compta-analytique/DotationsVirtualDrawer.tsx](frontend/src/components/compta-analytique/DotationsVirtualDrawer.tsx)) : drawer 650px spécialisé pour la ligne virtuelle `Dotations aux amortissements` (cf. backend Prompt A1). Branchement dans `CategoryDetailDrawer` quand `category === 'Dotations aux amortissements'` ET année complète (pas de filtre mois/trimestre). Délégation placée **après** les hooks pour respecter Rules of Hooks ; le hook `useCategoryDetail` est gated via `!isVirtualDotation`. Structure : header avec badge violet `calculé`, 3 MetricCards (Dotation brute / Déductible / Immos actives), bandeau info bleu, liste de cartes `ImmoCard` avec grid 4 colonnes + badge statut + **badge `Reprise {year}` ambre** si `is_reprise`. Footer CTA `Voir le registre →` qui met à jour `useFiscalYearStore.setYear(year)` avant `navigate('/amortissements')`. Empty state si `nb_immos_actives === 0`.

### Fixed (2026-04-27) — TypeScript : 64 → 0 erreurs sur `tsc -p tsconfig.app.json --noEmit`

Cleanup global des erreurs TypeScript pré-existantes accumulées au fil des évolutions (Recharts API breaking, Lucide v0.460 prop changes, EnrichedOperation type, etc.) :

- **Recharts Tooltip Formatter API (~13 erreurs)** — passage de `(v: number) => …` à `(v) => formatCurrency(Number(v))` dans 10 fichiers (LearningCurveChart, CategoryDetailDrawer, ComparatifSection, ComptaAnalytiquePage, QueryDrawer, HomePage, RevenueChart, TimelineChart, SimulationOptimisationSection, SimulationPrevisionsSection). Recharts a typé le 1er argument comme `ValueType | undefined` (= `number | string | ReadonlyArray<…> | undefined`). Solution : laisser TS inférer le type du parent et coercer via `Number(v)` à l'usage. `labelFormatter` similaire avec `String(label)`.
- **Lucide `title` prop (6 erreurs)** — `title` n'est plus une prop valide sur les icônes Lucide React. Pattern de wrap : `<span title="…" className="inline-flex"><Icon size={14} /></span>` dans 5 endroits d'EditorPage + 1 dans TemplatesTab.
- **`CategoryDetailDrawer` — `total_csg_non_deductible` / `csg_non_deductible` undefined (5 erreurs)** — `?? 0` sur `data.total_csg_non_deductible`, `data.total_deductible` et `op.csg_non_deductible` (champs Optional Pydantic).
- **`ExtractedFields.detected_fields` — champ `coordinates` manquant (4 erreurs)** — ajout de `coordinates?: FieldCoordinates | null` sur l'item du tableau (TemplatesTab le lit mais le type ne l'exposait pas).
- **`EnrichedOperation` cast `Record<string, unknown>` (8 erreurs)** — ajout d'index signature `[key: string]: unknown` à l'interface `EnrichedOperation` ([useJustificatifsPage.ts:23](frontend/src/hooks/useJustificatifsPage.ts:23)) — utilisé pour itérer dynamiquement sur les colonnes de filtre/tri.
- **`TimelineChart` BarMouseEvent (2 erreurs)** — `handleClick` retypé `(entry: unknown)` avec cast intérieur — Recharts a élargi le type d'event pour les Bar onClick.
- **Hooks de mutation Promise<unknown> (4 erreurs)** — `usePrevisionnel.useScanPrev/useRefreshEcheances/useScanPrelevements` + `useReports.useDeleteAllReports` retypés explicitement via le generic `api.post<T>()` / `api.delete<T>()`. `onSuccess` data correctement typée par inférence.
- **`useTemplates.useUpdateTemplate` signature** — passage de `Omit<JustificatifTemplate, …>` à `TemplateUpdatePayload` (qui autorise `null` pour `source_justificatif`, conforme à la mutation effective). `GedTemplateDetailDrawer` simplifié : `source_justificatif: tpl.source_justificatif || undefined` (au lieu de `|| null`).
- **`PipelineMetric.value` type élargi** — `string | number | undefined` (au lieu de `string | number`) — usePipeline avait des cas où la valeur pouvait être `undefined` (early-return + branches conditionnelles). `lockingStats` early-return `if (!operationsQuery.data)` enrichi avec `lockedInAssociated: 0, lockedOrphans: 0`.
- **`TypeForfait` étendu** — ajout de `'repas'` à l'union `'blanchissage' | 'vehicule' | 'repas'` (RepasTab utilisait déjà cette valeur).
- **Misc** — `ChargesForfaitairesPage` mutation `useCalculerBlanchissage` étendue avec `honoraires_liasse?: number | null` ; `SendToAccountantDrawer` `useRef<… | undefined>(undefined)` (signature explicite TS 5.x) ; `TaskCard` suppression de la 1ère prop `style` dupliquée ; `TasksPage.handleCreate` élargi `(data: TaskCreate | TaskUpdate)` ; `ProviderDrawer` setState avec cast vers union ; `HomePage.aggregateTrends(trends.trends_all)` au lieu de `trends` (qui est `TrendsResponse`, pas `TrendRecord[]`).

Aucune régression de comportement attendue — les fixes sont strictement typages. `npx tsc -p tsconfig.app.json --noEmit` passe désormais en 0 erreur (vs 64 avant).

### Fixed (2026-04-26) — Pipeline ↔ Justificatifs : alignement compteurs (étapes 3 + 4)

- **Étape 3 « Justificatifs & OCR »** — `cloture_service.get_annual_status` calculait `nb_justificatifs_total` / `nb_justificatifs_ok` en éclatant les ventilations (1 op de 3 sous-lignes = 3 unités) et utilisait le booléen `op.Justificatif` (qui peut diverger via `_mark_perso_as_justified`). Aligné sur `useJustificatifsPage.stats` : 1 op = 1 unité, op ventilée « avec » ssi **toutes** les sous-lignes ont un justif (`every`, pas `some`), op simple « avec » ssi `Lien justificatif` (string) non vide. Lettrage (`nb_operations` / `nb_lettrees`) reste éclaté — non concerné. Backend [services/cloture_service.py:73-103](backend/services/cloture_service.py:73).
- **Étape 4 « Verrouillage des associations »** — `usePipeline.lockingStats` accumulait 3 divergences vs `useJustificatifsPage.stats` : (a) dénominateur acceptait `vl.some(justif)`, maintenant `every` ; (b) exemptions (Perso, CARMF, URSSAF, Honoraires) ignorées, maintenant exclues via `useSettings()` + helper `isOpExempt` miroir ; (c) numérateur exigeait `(lien || hasVlJustif) && op.locked` qui masquait les ops verrouillées orphelines, maintenant compteur brut `op.locked === true` aligné sur la pill 🔒 Justificatifs. Nouvelle metric optionnelle `Lockées sans justif` visible quand `locked > lockedInAssociated` (signal d'orphelines : auto-lock cascade legacy ou dissociation post-lock). `taux` reste `lockedInAssociated / associated` ≤ 100 %. Frontend [hooks/usePipeline.ts:134-179](frontend/src/hooks/usePipeline.ts:134). Cas réel jan 2025 : pill Justificatifs = 77 = 35 (associated lockées) + 42 (orphelines), Pipeline ancien affichait `35` masquant les 42 orphelines.

### Added (2026-04-26) — Édition du type document GED

- **Backend** — `GedDocumentUpdate.type: Optional[str]` ajouté ([models/ged.py:93](backend/models/ged.py:93)). `ged_service.update_document` accepte le champ et applique une garde `_PROTECTED_TYPES = {"justificatif", "rapport", "releve"}` qui refuse toute conversion vers/depuis ces types (cycle de vie spécifique : OCR + ops, `report_service`, imports relevés) → `ValueError "Conversion de type interdite: …"`. Router PATCH retourne 400 (au lieu de 404) sur ce cas via détection du préfixe message ([routers/ged.py:98-105](backend/routers/ged.py:98)). `liasse_fiscale_scp` ajouté à `DEFAULT_DOCUMENT_TYPES` pour apparaître dans le datalist d'upload ([services/ged_service.py:1275-1279](backend/services/ged_service.py:1275)).
- **Frontend** — `GedDocumentDrawer` expose une section « Type de document » (select) avec libellés humanisés et 8 options non-protégées (`document_libre`, `liasse_fiscale_scp`, `contrat`, `attestation`, `devis`, `divers`, `courrier fiscal`, `courrier social`). Désactivé + note explicative si type courant protégé. `handleSave` propage `type` au PATCH + toast d'erreur si garde 400. Type `GedDocument.type` élargi à `GedKnownType | string` pour autoriser les types libres ([components/ged/GedDocumentDrawer.tsx](frontend/src/components/ged/GedDocumentDrawer.tsx), [types/index.ts:1116](frontend/src/types/index.ts:1116)).
- **Cas usage déclencheur** — `SCP_Compte de resultat 2025.pdf` uploadé en `document_libre` (valeur par défaut du `GedUploadZone`) n'apparaissait pas dans le filtre `type=liasse_fiscale_scp`. Désormais corrigeable directement depuis le drawer GED sans re-upload.

### Fixed (2026-04-20) — Recat. virements internes 2025 + patterns ML perso

- **2 ops 2025 recatégorisées `Revenus` → `perso`** — virements compte-à-compte internes qui polluaient `bnc.recettes_pro_bancaires` du Dashboard (458 370 € au lieu de 412 470 € cohérent avec l'Éditeur Honoraires). Fichier `data/imports/operations/operations_merged_202509_20260414_234739.json` : idx 50 (`VIREMENTSEPAEMIS/MOTIFIMPOTS/BENM 4000,00` 2025-09-17, 4 000 €) et idx 68 (`VIRSCTINSTEMIS/MOTIFVIREMENTDEM. 1000,00` 2025-09-22, 1 000 €). Traçabilité via `Commentaire`: `[2026-04-19] Recat. mouvement interne (ex: Revenus)`. Post-fix : Dashboard 2025 Recettes pro = 412 470 € (= Éditeur Honoraires), BNC estimé = 212 199 €.
- **Patterns ML perso élargis** — `data/ml/model.json` mis à jour pour auto-classifier les virements internes au prochain import. `keywords["perso"]` += `motifvirementdem`, `vircpteacpteemis`, `virementsepaemis`, `motifimpots` (substring matching prioritaire sur sklearn). `perso_override_patterns` += `motifvirementdem`, `vircpteacpteemis`, `motifimpots` (post-override fallback). Régression validée : `CARMF PRELEVEMENT` et les Honoraires/URSSAF/etc. classés correctement, les 3 libellés types (`VIREMENTSEPAEMIS/MOTIFIMPOTS/*`, `VIRSCTINSTEMIS/MOTIFVIREMENTDEM.*`, `VIRCPTEACPTEEMIS/MOTIFVIREMENT*`) désormais classés `perso` directement via substring match dans keywords.

### Added (2026-04-19) — BNC Split Pro/Perso + Liasse fiscale SCP

- **Fix critique calcul BNC** — `analytics_service.get_dashboard_data()` et `get_year_overview()` calculaient auparavant `solde = total_credit - total_debit` sur **toutes** les ops (perso incluses). Avec 2025 (crédits pro ≈ 458k, débits pro+perso ≈ 387k), le "Solde" affiché était une variation de trésorerie mixte qui n'avait rien à voir avec le BNC fiscal. Nouvelle règle unique : `BNC = recettes_pro − charges_pro_déductibles`, les ops `perso` sont **hors assiette** (ni recettes ni charges). Règle **déjà en place** dans `export_service._prepare_export_operations()` — réutilisée par import direct depuis `analytics_service` pour garantir une source of truth unique (pas de duplication).
- **Modèle de données BNC enrichi** — endpoints `/api/analytics/{dashboard,trends,compare,year-overview}` retournent désormais la structure 4-blocs `{bnc, perso, attente, tresorerie}` **en plus** des champs plats historiques `total_debit`/`total_credit`/`solde` (non-régression stricte). `bnc` expose `{recettes_pro, recettes_pro_bancaires, ca_liasse, base_recettes: "liasse"|"bancaire", charges_pro, solde_bnc, nb_ops_pro}`. Chaque entrée de `category_summary` porte un champ `nature: "pro"|"perso"|"attente"` (helper `_nature_of_category`). `get_monthly_trends` retourne 3 séries parallèles `{trends_all, trends_pro, trends_perso}`. `compare_periods` enrichi avec `bnc/perso/tresorerie` par période + `delta.bnc_solde/recettes_pro/charges_pro/perso_debit`. Signatures étendues : `get_dashboard_data(ops, ca_liasse?)`, `compare_periods(ops_a, ops_b, ca_liasse_a?, ca_liasse_b?)`.
- **Module Liasse fiscale SCP** — nouveau service `backend/services/liasse_scp_service.py` avec CRUD JSON (un fichier par exercice : `data/liasse_scp/liasse_{year}.json`). Router `backend/routers/liasse_scp.py` : `GET /api/liasse-scp/` (list), `GET/DELETE /{year}`, `POST /` (upsert), `GET /{year}/comparator` (écart CA liasse vs honoraires bancaires). Modèles Pydantic `LiasseScpCreate`, `LiasseScp`, `LiasseComparator`. Helper `get_ca_for_bnc(year) → Optional[float]` consommé par `analytics_service._bnc_metrics_from_operations`. Règle critique : `ca_liasse` injecté UNIQUEMENT sur année complète (`quarter is None AND month is None`) — sinon mélangerait recettes annuelles (liasse) avec charges partielles. Nouveau `LIASSE_SCP_DIR` dans `config.py` + `ensure_directories()`.
- **Type GED `liasse_fiscale_scp`** — icône `Landmark` + label "Liasse SCP" dans `GedDocumentCard` (`TYPE_ICON`/`TYPE_LABEL`), `GedDocumentList` (`TYPE_LABELS`/`TYPE_COLORS` avec `bg-orange-500/15 text-orange-400`), `GedSearchBar` dropdown type, `GedTreePanel` typeMap (3 endroits). Union `GedDocument.type` élargie côté frontend.
- **Drawer `LiasseScpDrawer` (520px)** — monté globalement dans `App.tsx` via store Zustand `liasseScpDrawerStore`. Header avec selector année corrigeable + pastille verte discrète `détecté depuis …` si source ≠ `fiscal_store`. Section 1 : card document GED lié (si `gedDocumentId` fourni) avec bouton "Ouvrir" (endpoint existant `POST /api/ged/documents/{id}/open-native`). Section 2 : input CA large (18px) format FR avec placeholder "312 580,00" + suffixe €, parsing tolérant via `parseFrAmount()` (accepte "312 580,00", "312580", "312580.00", "312 580.00"). Section 3 : comparateur live (CA vs honoraires bancaires via `useDashboard`, écart absolu + pct avec seuils colorés >10% rouge / 5-10% orange / <5% neutre). Info-box bleue sur l'écart attendu (décalages trésorerie, prélèvements SCP, régularisations). Footer : boutons Annuler / Valider le CA (ou "Mettre à jour" en édition) + lien Supprimer en rouge si liasse existante.
- **Résolveur d'année pur** — `frontend/src/lib/liasse-year-resolver.ts` expose `resolveLiasseYear(gedDoc, fallbackYear) → {year, source}` testable séparément. Cascade : `ged.year` (si plausible 2000 ≤ y ≤ now+1) > `ged.date` (regex `^(\d{4})`) > `ged.filename` (regex `\b20\d{2}\b` avec UNE seule occurrence pour lever l'ambiguïté) > `fallbackYear` (fiscal store). Retourne la source pour afficher la pastille de détection. Consommé par `GedDocumentDrawer` pour le bouton "Saisir/Modifier le CA" sur les docs `liasse_fiscale_scp` (couleur verte + montant si déjà saisi via `useLiasseScp`, ambre sinon).
- **Compta Analytique — refonte KPIs BNC** — `ComptaAnalytiquePage` expose 3 KPIs principaux refondus : **Recettes pro** / **Dépenses totales** (pro + perso + attente) / **BNC estimé** (au lieu de Total Dépenses / Total Revenus / Solde mixte). Sous-labels informatifs : `crédits bancaires · provisoire` OU `liasse SCP · définitif` selon `base_recettes`. Nouveau composant `BncBanner` au-dessus des KPIs : bandeau ambre "BNC provisoire — base bancaire pour {year}" avec CTA "Saisir le CA" → drawer, OU bandeau vert "BNC définitif — base liasse fiscale SCP · X €" avec écart bancaire coloré (>10% rouge, 5-10% orange) et lien "Modifier". Bandeau masqué si filtre mois/trimestre actif. Card `VentilationDepensesCard` sous les KPIs : barre empilée horizontale 10px violet (#7F77DD, pro) / gris (#B4B2A9, perso), grid 2 colonnes "Pro déductible" (badge violet "dans le BNC") / "Perso" (badge gris "hors BNC") avec montants, %, nb_ops, top 3 catégories.
- **Segmented control Nature Pro/Perso/Tout** — nouveau composant `NatureFilter` (`components/compta-analytique/NatureFilter.tsx`) piloté par `useState<NatureFilterValue>('pro')` local, défaut **Pro**. Propage sur : tableau catégories (`filteredCategorySummary` par nature), graphe d'évolution (`trendsSelected` sélectionne `trends_pro`/`trends_perso`/`trends_all`), **et ComparatifSection** (state local propre pour filtrer `data.categories` par `nature`). `CategoryDetailDrawer` enrichi avec badge nature dans le header (violet `#EEEDFE/#3C3489` pro / gris perso / ambre attente via helper `NatureBadge`).
- **Dashboard — KPI Recettes pro + ligne CA liasse** — `KpiCards` affiche "Recettes pro" (au lieu de "Recettes") avec badge discret sous le montant : `liasse · définitif` (vert + `CheckCircle2`) si CA saisi, sinon `provisoire · bancaire` (ambre + `AlertTriangle`) **cliquable** → ouvre le drawer. `RevenueChart` accepte prop `caLiasse?: number | null` : si fourni, affiche `ReferenceLine` horizontale pointillée violette (#7F77DD) au niveau `ca_liasse / 12` (moyenne mensuelle cible) avec label "CA liasse ÷ 12 : X €" et légende dédiée. Refactor `get_year_overview()` : itère `mois_data` en sommant `bnc_recettes_pro` + `bnc_charges_pro` (au lieu de `total_credit` + `total_debit` qui incluaient perso) pour calculer `kpis.{total_recettes, total_charges, bnc_estime}`. `delta_n1` idem (recalcul via `_bnc_metrics_from_operations(prev_all_ops, prev_ca_liasse)`).
- **Non-régression** — tous les consommateurs actuels de `total_debit`/`total_credit`/`solde` continuent à recevoir ces champs plats. Réconciliation backend validée sur 2025 (1023 ops) : `perso.total_debit 186 777 + bnc.charges_pro 200 271 + attente.total_debit 0 = tresorerie.total_debit 387 049` ✓. BNC bancaire 258 099 € (recettes 458 370 − charges 200 271), BNC liasse 112 309 € (CA 312 580 − charges 200 271). Drawer round-trip validé end-to-end via preview MCP : CA saisi → bandeau bascule ambre→vert, KPIs refresh, cache TanStack invalidé (`['analytics']`, `['dashboard']`, `['year-overview']`).

### Added (2026-04-18) — Polish UX

- **Badge « Voir toutes » header Éditeur/Justificatifs** — pill amber `FilterX` dans `PageHeader.actions` ([EditorPage.tsx:1523](frontend/src/components/editor/EditorPage.tsx:1523), [JustificatifsPage.tsx:269](frontend/src/components/justificatifs/JustificatifsPage.tsx:269)), visible uniquement quand au moins un filtre est actif. Reset complet en un clic : Éditeur (`headerFilter`, `columnFilters`, `globalFilter`, `filterUncategorized`) / Justificatifs (`search`, `justifFilter='all'`, `categoryFilter`, `subcategoryFilter`, `sourceFilter='all'`). Le filtre défaut `justifFilter='sans'` compte comme restriction → la pill apparaît dès l'ouverture de Justificatifs et le clic passe à `'all'` pour voir 100% des ops.

### Fixed (2026-04-18)

- **LockCell déverrouillable sur parent ventilé auto-locké** — [LockCell.tsx:18](frontend/src/components/LockCell.tsx:18) : `if (!hasJustificatif && !locked) return null` (au lieu de `!hasJustificatif`). Le bouton déverrou apparaît désormais même si `op.Justificatif` est falsy tant que `op.locked=true`. Fallback miroir dans [JustificatifsPage.tsx:957](frontend/src/components/justificatifs/JustificatifsPage.tsx:957) quand `isLockable=false` + `op.locked=true` (cas parent ventilé partiellement associé qu'une sous-ligne ≥0.95 a auto-lockée). Avant : utilisateur voyait le lock orange mais rien à cliquer.
- **SandboxArrivalToast persistant pour auto-associé** — [useSandbox.ts:134](frontend/src/hooks/useSandbox.ts:134) : `duration: Infinity` pour les 2 variantes (violet + victoire emerald). Avant, la variante auto-associée avait `duration: 8000ms` qui disparaissait avant que l'utilisateur puisse le lire, surtout en cas de HMR/reload.
- **JustificatifOperationLink invalide les caches aussi sur erreur** — [JustificatifOperationLink.tsx:98-113](frontend/src/components/shared/JustificatifOperationLink.tsx:98) : ajout `['ocr-history']` dans `onSuccess`, et dans `onError` invalidation des 3 caches (`justificatif-reverse-lookup`, `justificatif-operation-suggestions`, `ocr-history`) pour refresh les suggestions obsolètes après un 423 (op lockée) ou 409 (déjà associée). Durée toast erreur passée à 6s. Avant : click Associer sur suggestion obsolète → 423 silencieux → utilisateur re-clique sans comprendre.

### Added (2026-04-18) — Polish Rapports + Snapshots

- **Titre auto des rapports : inclusion des sous-catégories** — `buildReportTitle()` (`frontend/src/components/reports/ReportsPage.tsx`) accepte désormais `selectedSubcategories` + `allSubcategoriesCount`. Quand au moins une sous-cat est sélectionnée ET que ce n'est pas l'intégralité des sous-cats disponibles pour les cats cochées, le titre intercale ` · {Sous-cats}` entre la catPart et la périodePart (ex. `Véhicule · Essence, Péage — Janvier 2026`). Mêmes paliers que la catPart : 1-4 listées, 5+ avec `… (+N)`. Omis si 0 sous-cat OU toutes (équivalent à pas de filtre → on reste sur `Véhicule — 2026`). Nouveau `allSubCount` mémoïsé à partir de `filters.categories` + `categoriesData?.categories`. Propagé à `autoTitle` (preview live) ET au loop batch 12 mois (titres mensuels cohérents). Aucun changement d'API, pur frontend.
- **Snapshot depuis l'Éditeur en mode « Toute l'année »** — retrait du gate `&& !allYearMode` sur le bouton `Snapshot (N)` du header EditorPage ([EditorPage.tsx:1563](frontend/src/components/editor/EditorPage.tsx:1563)). L'infrastructure supportait déjà les refs multi-fichiers : `selectedOpsRefs` lit `op._sourceFile ?? selectedFile` (enrichi par `useYearOperations`), `suggestedSnapshotName` gère déjà `allYearMode` (`"{Année} (toute l'année) — …"`), `SnapshotCreateModal` est mode-agnostique, et `snapshot_service.resolve_snapshot_ops` itère sur `ops_refs` avec un `file_cache` + self-healing par hash op-identité. Débloque le cas d'usage transverse (« Litige Amazon 2026 », « Notes de frais non remboursées ») où la sélection couvre plusieurs mois. Aucune modification backend, `data/snapshots.json`, ou modèles.

### Added (2026-04-18) — Session 31 · Export Ventilation + Toast Victoire + Dédup fichiers

- **Ventilation par catégorie dans chaque export ZIP** — 2 nouveaux fichiers `Ventilation_par_categorie_YYYY-MM_Mois.{pdf,csv}` ajoutés à la racine de chaque ZIP (export simple et batch multi-mois). Les ops du mois sont groupées par `Catégorie → Sous-catégorie` avec sous-totaux par sous-cat + TOTAL par cat en bandeau bleu foncé + TOTAL GÉNÉRAL en bandeau noir. PDF A4 portrait (ReportLab, logo, header table bleu `#D5E8F0`, tableau compact, pagination), CSV FR avec BOM/CRLF/séparateur `;`. Nouveaux helpers dans `backend/services/export_service.py` : `_group_by_category(prepared)` (agrège pro+perso+attente, tri alpha cat puis sous-cat), `_generate_pdf_by_category`, `_generate_csv_by_category`, `_category_pdf_filename(year,month)`, `_category_csv_filename(year,month)`. Hookés dans `generate_single_export` (entre les PDF/CSV chronologiques et le relevé) et `generate_batch_export` (sous `{Mois}_{Année}/` de chaque mois). `try/except` pour ne pas casser l'export si la génération par catégorie échoue.
- **Toast victoire OCR auto-associé** — `SandboxArrivalToast` gagne une variante dédiée (`autoAssociated === true`) avec rendu festif : gradient `emerald-400/80 → lime-400/60 → yellow-300/70`, icône `Trophy` dorée (remplace `CheckCircle2`), titre « C'est dans la boîte ! » (remplace « Associé automatiquement »), animation d'entrée `animate-victory-bounce` (cubic-bezier(0.34,1.56,0.64,1), 450ms avec scale 0.85→1.04→1), anneau pulsant one-shot `animate-victory-ring` (scale 0.6→1.7, 1.1s), et **ConfettiBurst** : composant local qui rend 8 particules via spans absolus positionnés au centre de l'icône, chacune avec custom props `--cx`/`--cy`/`--cr` (angles 0°/45°/90°/135°/180°/225°/270°/315° × rayon ~42px), couleurs variées (emerald/lime/yellow/amber/teal/rose/sky/violet-400), délais échelonnés 0-90ms, animation `victory-confetti` 900ms forwards. Durée auto-dismiss **8000ms** (vs `Infinity` pour la variante violet normale). 3 nouvelles keyframes dans `frontend/src/index.css` : `victory-confetti`, `victory-ring`, `victory-bounce`. `CheckCircle2` retiré des imports lucide-react (plus utilisé).
- **Colonne « Date scan » dans OCR Traités** — nouvelle colonne dans `OcrListTab` visible uniquement si `statusFilter === 'traites'`. Header triable (clic → toggle asc/desc), réutilise le sort `scan_date` existant (Session 30 : trie par `processed_at` et ignore les filtres année/mois/fournisseur). Cellule affiche `JJ/MM/AAAA` + heure `HH:MM` sur 2 lignes (10px, opacity 60%). Fallback `-` si `processed_at` manquant. Masquée dans En attente (condition explicite `statusFilter === 'traites'`).
- **Fac-similé fallback aussi pour templates scannés sans coords** — `generate_reconstitue()` (`backend/services/template_service.py`) : la branche `elif source_pdf and tpl.is_blank_template:` devient `elif source_pdf:` → `_generate_pdf_blank_overlay` couvre désormais 2 cas : (a) blank template sans coords (placeholders `{KEY}` substitués dans le text layer), (b) template scanné classique dont le PDF source est image-only (pdfplumber retourne 0 mots → aucun champ positionnable via `_enrich_field_coordinates` → `fields_with_coords = []`). Avant, cas (b) tombait sur le fallback ReportLab sobre (A5, ~1.8 ko) qui ignorait totalement le scan. Maintenant, rasterisation du scan en fond + overlay date/TTC haut-droite via rectangle blanc + Helvetica 7-10pt. Résout le bug « fac-similé parking sobre » pour `tpl_c3df54e2` (PARC CONSUL DUPUY) dont le source scan n'a pas de text layer.
- **Script `scripts/dedup_operations_file.py` pour dédoublonnage intra-fichier** — complément des scripts split/merge existants : cible un fichier d'ops unique (pas un mois) et retire les doublons internes via hash op-identité (`(Date, Libellé.strip, Débit, Crédit)`). Garde la version `max(enrichment_score)` par groupe (égalité → plus petit indice). Rebinde les refs GED (`ged_metadata.json:documents[].operation_ref`) et `.ocr.json` (`operation_ref.{file,index}`) vers les nouveaux indices du fichier dédup'd. Archive le fichier source dans `_archive/*.bak_<ts>` avant écriture. Réutilise `op_hash` + `enrichment_score` + `load_json`/`save_json` via import depuis `merge_overlapping_monthly_files.py`. Mode `--dry-run` (résumé seul) + `--yes` (apply sans prompt). Exemple : `operations_split_202501_20260414_233641.json` : 86 ops → 78 ops (8 doublons retirés, dont Amazon 25,52 € 31/01 qui était en double : version ventilée enrichie + version Fournitures vide), 24 refs GED rebindées + 2 refs OCR.
- **`_find_bank_statement` fallback pour fichiers merged/split** — la regex historique `operations_\d{8}_\d{6}_<hex>.json` échouait pour les fichiers issus des scripts split/merge (`operations_(merged|split)_YYYYMM_*.json` — le hex d'origine est perdu). Nouveau fallback : scan `data/imports/operations/_archive/*.bak_*`, extraction du hex de chaque archive original (`operations_\d{8}_\d{6}_([a-f0-9]+)\.json\.bak_...`), résolution de son `pdf_<hex>.pdf` dans `IMPORTS_RELEVES_DIR`, et scoring par tuple `(is_monthly, nb_ops_dans_mois, concentration)` — `is_monthly=True` si ≥ 80% des ops de l'archive tombent dans le mois cible (vrai fichier mensuel gagne), sinon fallback sur celui avec le plus d'ops dans le mois cible. Seuil `nb_in_month >= 3` pour éviter les faux positifs sur overflow de quelques ops. Résout l'absence de `releves/pdf_<hex>.pdf` dans les ZIP pour tous les mois post-split/merge.
- **Dédup historique des exports par `(year, month, format)`** — `_log_export` (`backend/services/export_service.py`) retire toute entrée antérieure du même triplet avant d'appender la nouvelle, **et supprime le ZIP correspondant du disque** (best-effort — `unlink()` dans un try/except OSError). L'ancien comportement était append-only → après plusieurs regens successives d'un même mois, l'historique accumulait 13 copies Janvier PDF, 5 copies Janvier CSV, etc. (40 entrées au total pour 13 mois distincts, observé dans le `exports_history.json` de prod). Nouveau comportement : le dernier export wins, historique reste propre, disque aussi. Nettoyage rétroactif appliqué : 40 → 13 entrées uniques, 27 doublons purgés.

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

### Fixed (2026-04-17) — Session 30.1 · Shutdown propre du backend (fix reloads bloqués)

- **Nouveau `backend/core/shutdown.py`** exposant `shutdown_event: asyncio.Event` global set au début du lifespan shutdown. Les boucles background checkent cet event au lieu d'un `asyncio.sleep()` nu. Helper `is_shutting_down()` pour les checks impératifs.
- **`_previsionnel_background_loop` (main.py)** : remplace `await asyncio.sleep(3600)` par `await asyncio.wait_for(shutdown_event.wait(), timeout=3600)` → sortie sub-seconde au shutdown au lieu d'attendre la fin du sleep. Même traitement pour le sleep de démarrage (30s). Condition de boucle `while not shutdown_event.is_set()`.
- **`sandbox_auto_processor.auto_processor_loop`** : même transformation coopérative. `while not shutdown_event.is_set()` + `asyncio.wait_for(shutdown_event.wait(), timeout=10)` dans la boucle principale **et** dans le handler d'erreur (évite qu'un crash lock le shutdown pendant 10s).
- **Lifespan shutdown** : les 2 background tasks (`_prev_task`, `_sandbox_auto_task`) sont maintenant **awaitées** via `asyncio.gather(..., return_exceptions=True)` avec timeout global 1.5s (sous le budget 2s d'uvicorn). Auparavant seulement `.cancel()` sans await → uvicorn ne savait pas quand elles finissaient. Ordre : `shutdown_event.set()` → `stop_sandbox_watchdog()` → `cancel()` + `gather()`. Log warning si tasks encore non terminées après 1.5s.
- **`sandbox_service.stop_sandbox_watchdog()`** : `_observer.join(timeout=5)` → `timeout=1.0`. 5s était > 2s du `--timeout-graceful-shutdown` uvicorn, donc le join était coupé en plein milieu par un SIGKILL → port potentiellement squatté. L'observer est `daemon=True` donc aucun risque de leak persistant (Python le collecte au process exit). Warning loggué si encore alive après 1s. `try/finally` pour garantir le reset de `_observer` même si le stop lève.
- **SSE `_sse_generator` (routers/sandbox.py)** : check explicite `shutdown_event.is_set()` dans la condition de boucle + timeout heartbeat 30s → 2s (réactivité shutdown). La combinaison `shutdown_event` + `CancelledError` (propagée par FastAPI au disconnect client) couvre les deux cas de sortie.
- **Contrat** : toute nouvelle boucle asyncio longue ou SSE DOIT checker `shutdown_event` via `while not shutdown_event.is_set()` ou `asyncio.wait_for(shutdown_event.wait(), timeout=N)`. **Ne jamais** écrire `while True: await asyncio.sleep(N)` nu.

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
