# NeuronXcompta V3

**Assistant Comptable IA** pour cabinet dentaire.

Application full-stack de gestion comptable avec catégorisation automatique par IA, OCR des justificatifs, rapports multi-formats et exports comptables.

---

## Fonctionnalités

| Module | Description |
|--------|-------------|
| **Accueil (HomePage)** | **Vraie page d'accueil chaleureuse** servie sur `/` (le Pipeline migre vers `/pipeline`). Répond à *« que dois-je faire maintenant ? »* — distincte du Dashboard rétrospectif et du Pipeline procédural. Aurora signature en arrière-plan (3 blobs `radial-gradient` violet/emerald/amber dérivants), **`LogoLockup` 64px** avec chorégraphie 5 phases (logo-enter + halo-burst violet + double shimmer gauche→droite puis droite→gauche + halo-breathe ∞ subtil), **`HeroBlock`** (greeting contextuel selon l'heure / date longue FR / phrase rotative crossfade 4.5s parmi 6), **`NextActionCard`** avec algo 5 règles ordonnées (échéance ≤7j → uncategorized >5 → orphan justif >3 → cloture_ready N-1 ≥95% → idle "Bel ouvrage") propulsant vers la bonne page, **3 PulseCards** en grid (ring SVG mois en cours + value `J–N` prochaine échéance + dot animé alertes avec sévérité), **5 QuickActions** (Importer/OCR/Éditeur/Justificatifs/Rapprocher). Aucun nouvel endpoint backend — tout vient des hooks existants (`useCloture`, `useEcheances`, `useAlertesSummary`, `useOperations`). Mount FastAPI `/assets` (servant `backend/assets/logo_lockup_dark_400.png`) + entrée Vite proxy. Sidebar : item **Accueil** (icône `Sparkles` violet) en TOUT premier hors-groupe avant Pipeline et Envoi comptable |
| **Tableau de bord** | **Cockpit exercice V2** : jauge segmentée 6 critères, KPIs avec sparkline BNC, grille 12 mois cliquables avec badges d'état, alertes pondérées, échéances fiscales, rappels rapports, bar chart recettes/dépenses. **KPI Recettes pro** avec badge `liasse · définitif` (vert) ou `provisoire · bancaire` (ambre, cliquable → drawer liasse). `RevenueChart` affiche une `ReferenceLine` pointillée violette au niveau `ca_liasse / 12` (moyenne mensuelle cible) si liasse saisie. `kpis.{total_recettes, total_charges, bnc_estime}` agrégés depuis `bnc_recettes_pro`/`bnc_charges_pro` mensuels (exclut perso) |
| **Liasse fiscale SCP** | Saisie annuelle du CA déclaré sur la liasse 2035 (quote-part SCP). Stockage `data/liasse_scp/liasse_{year}.json` (un fichier/exercice). `LiasseScpDrawer` (520px) monté globalement via store Zustand, ouvert depuis : (a) bouton "Saisir/Modifier le CA" sur les docs GED `liasse_fiscale_scp`, (b) bandeau `BncBanner` de Compta Analytique, (c) badge `provisoire · bancaire` cliquable du Dashboard. Résolveur d'année pur `resolveLiasseYear(gedDoc, fallback)` (cascade `ged.year > ged.date > ged.filename regex non-ambigu > fiscal_store`), corrigeable via selector avec pastille verte de détection. Comparateur live CA vs honoraires bancaires avec seuils colorés (>10% rouge, 5-10% orange). Tant que non saisi : BNC **provisoire** basé crédits bancaires. Dès saisie : BNC **définitif** basé CA liasse. Endpoints `/api/liasse-scp/{list,{year},/{year}/comparator}`. Type GED `liasse_fiscale_scp` avec icône `Landmark` |
| **Pipeline** | **Pipeline comptable interactif** : **stepper 7 étapes** (Import → Catég → Justif → **Verrouillage** → Lettrage → Vérification → Clôture), progression globale pondérée `[10, 20, 20, 10, 20, 10, 10]`, sélecteur mois/année, **widget « Scans en attente d'association »** (filtré par year+month, sections OCR récents / Fac-similés, lien « Traiter » vers Justificatifs, **collapsed par défaut** à chaque ouverture), **badge orange sidebar** sur `/ocr` (compteur pending scans), **titre d'onglet navigateur** synchronisé avec la route courante (utile en multi-tabs) |
| **Verrouillage associations** | Champ `locked` sur chaque opération, posé **automatiquement** à toute association manuelle (via `associate-manual`). Auto-rapprochement skippe les ops lockées silencieusement. Gardes HTTP 423 sur re-association / dissociation. Composant `LockCell` (cadenas orange `text-warning` si locked / gris `LockOpen` sinon) avec tooltip riche démonstratif ancré à droite. Intégration JustificatifsPage (cellule Justif) + EditorPage (colonne dédiée 44px). Modale `UnlockConfirmModal` de confirmation pour déverrouiller. Endpoint `PATCH /api/operations/{filename}/{index}/lock`. **Bulk-lock / bulk-unlock** : sélection multi-ops via header 🔒 + checkbox hover, `BulkLockBar` flottante avec toggle intelligent Verrouiller (orange) ↔ Déverrouiller (vert) selon l'état des ops sélectionnées, endpoint `PATCH /api/operations/bulk-lock` (multi-fichiers, erreurs par-item). Disponible sur JustificatifsPage + EditorPage (masquée en year-wide lecture seule) |
| **Snapshots** | Sélections nommées d'opérations réutilisables (ad-hoc folders pour suivi : "Litige Amazon", "À vérifier comptable", "Acompte Q4"). Stockage `data/snapshots.json` avec refs `(file, index)` **self-healing** via hash op-identité + archive lookup (survit aux split/merge/archive de fichiers ops). Page dédiée `/snapshots` (sidebar OUTILS, icône Camera) avec grille de cartes (pastille couleur, stats live Ops/Débits/Solde, badge ambre si refs cassées). Création depuis EditorPage via bouton « Snapshot (N) » en orange quand `rowSelection > 0` → modal avec nom pré-rempli contextuel, description, 6 couleurs. Drawer viewer 760px avec titre renommable inline + tableau ops + lien `ExternalLink` → éditeur |
| **Éditeur — Bandeau stats filtrées + ligne TOTAL sticky** | Quand un filtre est actif (recherche globale, filtre colonne, non-catégorisées), affichage en haut d'un **bandeau violet** avec `{N} op(s) filtrée(s) sur {total}` + Débits/Crédits/Solde recalculés depuis `table.getFilteredRowModel()`. Et en bas du `<tbody>` une **ligne TOTAL éphémère** encadrée orange (sticky bottom-0, bordures `border-y-2 border-warning`, gradient warning, symbole ∑, Solde dans pill colorée vert/rouge). Jamais sauvegardée (safe au PUT). Pratique pour vérifier rapidement le total d'un mois/catégorie/fournisseur. **Ligne TOTAL répliquée aussi dans JustificatifsPage** (miroir exact, visible quand au moins un filtre narrowing est actif) |
| **Note de frais** | Champ `source: Optional[str]` sur `Operation` (valeurs connues `"note_de_frais" \| "blanchissage" \| "amortissement" \| None`). Badge pill **amber** `#FAEEDA/#854F0B` affiché au-dessus du select Catégorie si `source === 'note_de_frais'` dans **EditorPage**, **JustificatifsPage** et **AlertesPage**. Split button `+ Ligne ▾` dans EditorPage : bouton principal = op bancaire, chevron = dropdown avec `Note de frais (CB perso)`. **Filtre Type d'opération** dans 4 pages (Éditeur Filtres panel, Justificatifs toolbar, Rapports 3 pills, Compta Analytique widget `Répartition par type` avec share%). Endpoint analytics étendu avec `by_source: [{source, debit, credit, count}]`. Round-trip JSON transparent (pas de migration nécessaire) |
| **Fichier mensuel vide à la demande** | Dropdown mois de l'Éditeur expose les **12 mois** même sans fichier (mois sans fichier affichés en `{Mois} — vide · créer`). Sélection → confirmation → `POST /api/operations/create-empty {year, month}` → création immédiate de `operations_manual_YYYYMM_<hex8>.json` → auto-select + toast. Débloque la saisie de notes de frais CB perso quand le relevé bancaire n'est pas encore importé. Fusion ultérieure assurée par les scripts `split/merge_*.py` existants via hash op-identité |
| **Importation** | Upload de relevés bancaires PDF, extraction automatique des opérations (dates YYYY-MM-DD, filtrage soldes/totaux) |
| **Éditeur** | Édition inline (EditableCell avec commit onBlur), catégorisation IA (vides/tout), **vue année complète** (lecture seule), **filtres catégorie + sous-catégorie**, **6 pills cliquables dans le header** (compteurs live + filtres toggle) : 📎 avec (vert) / 📎 sans (ambre, exclut exemptées) / ✓ exempt (sky, conditionnel) / 🔒 locked (orange) / 🔓 unlocked (rose, « à valider ») / 📄 facsimile (violet, conditionnel). Un seul filtre actif à la fois, reset automatique au changement de fichier. Colonnes : Justificatif (**icône `Ban` rouge barré pour ops perso — aucun justificatif requis**), Important, À revoir, Pointée, **ventilation** (bouton Scissors, **sous-lignes en gris foncé `bg-black/30`** pour contraste visuel, **trombones cliquables par sous-ligne** : vert = preview PDF / ambre = attribution drawer avec sous-ligne pré-sélectionnée via `initialVentilationIndex`), **drawer preview justificatif avec sous-drawer grand format** (toute la zone PDF cliquable → `PreviewSubDrawer` slide à gauche 700px avec bouton « Ouvrir avec Aperçu ») |
| **Catégories** | Gestion des catégories/sous-catégories avec couleurs personnalisées |
| **Rapports** | Generation PDF/CSV/Excel avec logo, colonnes Justificatif et Commentaire, **5 templates** (3 standards + **2 amortissements** : Registre / Tableau dotations), checkboxes modernes categories, batch 12 mois, export ZIP comptable, **déduplication avec archivage** (ancien rapport archivé dans `reports/archives/`), **dédup par `dedup_key(filters)`** pour templates avec renderer custom (helper `report_service.get_or_generate(template_id, filters, format)` — cache hit si même clé+format, élimine la duplication entre UI Rapports / OD dotation / export ZIP), **ventilation éclatée en N sous-lignes** avec libellé `[V1/N]` (plus de catégorie 'Ventilé' agrégée, totaux correctement répartis par sous-catégorie). Bibliotheque migree vers GED V2 |
| **Compta Analytique** | Filtres globaux (année/trimestre/mois), drill-down catégorie, **comparatif périodes avec séparation recettes/dépenses**, tendances (agrégé/catégorie/empilé), anomalies, requêtes personnalisées, **encadré déductibilité CSG/CRDS** dans le drawer URSSAF avec bouton batch « Calculer tout ». **Refonte KPIs BNC** : 3 cartes principales Recettes pro / Dépenses totales / BNC estimé (source fiscale unique, exclut perso de l'assiette). Bandeau `BncBanner` ambre "BNC provisoire" (CTA "Saisir le CA") ou vert "BNC définitif · X €" avec écart bancaire coloré. Card `VentilationDepensesCard` : barre empilée violet/gris + split Pro "dans le BNC" / Perso "hors BNC" avec top catégories. Segmented control `NatureFilter` (Pro/Perso/Tout, défaut Pro) pilote tableau catégories + graphe d'évolution (`trends_pro`/`trends_perso`/`trends_all`) + ComparatifSection. Badge nature dans header `CategoryDetailDrawer`. Endpoints enrichis `/api/analytics/{dashboard,trends,compare,year-overview}` avec structure 4-blocs `{bnc, perso, attente, tresorerie}` en plus des champs plats historiques (non-régression) |
| **Association manuelle (op → justif)** | **`ManualAssociationDrawer`** 1100 px (s'élargit à **1500 px** quand le preview PDF est ouvert, panel preview 600 px pour lisibilité) — outil 2-colonnes parallèles (ops \| justificatifs), **filtres libres date ±j / montant ±€** (date via calendrier natif `<input type="date">`, défauts `{year}-{MM}-15 ±15j` = mois sélectionné dans l'Éditeur), toggle **« Élargir »** (bypass du pré-filtre ±1 mois backend via `/justificatifs/?status=en_attente`), badges colorés OCR sur chaque row (sky date, ambre montant, « n/a » si absent), `PdfThumbnail` 32×38 px cliquable. **Panneau ops filtre automatiquement les exemptées** (Perso/CARMF/URSSAF/Honoraires via `appSettings.justificatif_exemptions` — en mode `'all'` uniquement, mode `targeted` respecte la sélection utilisateur). 2 points d'entrée : JustificatifsPage (header + barre flottante batch) et EditorPage (header + bouton sélection à côté de Snapshot). Raccourcis ↓↑→Enter Esc. Complémentaire au `RapprochementWorkflowDrawer` scoré mono-op (qui reste pour le flux standard) |
| **Association sens inverse (justif → op)** | **`JustifToOpDrawer`** 1000px ouvert depuis `GedDocumentDrawer` pour justifs `en_attente`. Sous-drawer preview PDF **grand format** (700px) à gauche du drawer parent via `PreviewSubDrawer` z-65. Panneau gauche = liste justifs en attente avec recherche filename+supplier, panneau droit = ops candidates scorées avec `ScorePills`. **Édition inline OCR** sous la row sélectionnée (date/montant/supplier → `PATCH /ocr/.../extracted-data` → rescoring live). Badge `Lock` warning + bouton « Déverrouiller » par row (backend expose `op_locked` dans les suggestions). **Self-heal** des `operation_ref` désynchronisés (après merge/split) via scan du fichier sur `Lien justificatif`. Actions enrichies dans `GedDocumentDrawer` : 3 boutons conditionnels (Dissocier, Déverrouiller, Supprimer) |
| **Justificatifs** | **Vue opérations-centrée** avec **5 pills cliquables** (avec vert / sans ambre / exempt sky / locked warning / facsimile violet) qui remplacent l'ancien groupe 4-boutons — compteurs live + filtres toggle, extension du `justifFilter` (type `'all' \| 'sans' \| 'avec' \| 'exempt' \| 'locked' \| 'facsimile'`). `'avec'` strict (exclut exemptées, alignement EditorPage). **Sous-lignes ventilées en gris foncé `bg-black/30`** pour distinction visuelle. **`RapprochementWorkflowDrawer` unifié** (700px, 2 modes « Toutes sans justificatif » / « Opération ciblée », progress bar, tabs, ventilation pills, raccourcis ⏎/←/→/Esc, ScorePills 4 critères, thumbnails lazy-loaded via IntersectionObserver, recherche libre exclusive). **Auto-rapprochement** avec scoring v2 (4 critères + pondération dynamique), preview justificatif avec dissociation, 4 KPIs couverture, sandbox SSE. **Catégories/sous-catégories éditables inline** (dropdowns, sauvegarde auto, mode « Toute l'année » supporté). **Filtres catégorie/sous-catégorie persistants** au changement de mois (mêmes états React conservés). **Batch reconstitution fac-similé** (multi-sélection → barre flottante → drawer choix template par groupe → génération batch). **Exemptions** CARMF/URSSAF/Honoraires (CheckCircle2 bleu ciel, tooltip) + **icône `Ban` rouge barré dédiée pour ops perso** (priorité sur la branche exempté, tooltip « aucun justificatif requis »). **Navigation bidirectionnelle** Justificatif ↔ Opération avec row surlignée persistante via `isNavTarget`. **Vue ventilée** : ligne parente + sous-lignes indentées L1/L2 avec trombone individuel par sous-ligne, `CheckCircle2` vert sur la parente si `allVlAssociated`. **Suppression complète** avec toast détaillé listant les nettoyages (PDF + thumbnail + GED metadata + liens ops parentes et ventilées + cache). |
| **Agent IA** | Modèle ML hybride : **rules-based** (`exact_matches` + `keywords` substring scoring + `perso_override_patterns`) prioritaire sur **sklearn** (`LinearSVC` wrappé dans `CalibratedClassifierCV(cv=2)` pour `predict_proba`, `class_weight='balanced'`, `perso` filtré du training). Benchmark corpus réel : **accuracy 90.1%** via règles+keywords+override (vs ~27% sklearn seul). Dashboard ML + onglet Monitoring (4 sections : Performance / Fiabilité / Progression / Diagnostic), courbe d'apprentissage, backups. **Auto-alimentation ML** depuis corrections manuelles (dédup `(libelle, categorie)`, effet immédiat sur `exact_matches`). **Bulk-import** `/ml/import-from-operations?year=...` (UI bouton bleu Database dans ActionsRapides). **Tâche auto `ml_retrain`** (6e détection `task_service`) + **Toast cerveau animé** au montage 1×/session si corrections accumulées dépassent les seuils Settings (`ml_retrain_corrections_threshold=10`, `ml_retrain_days_threshold=14`, configurables dans GeneralTab). `categorize_file()` respecte `op.locked` (plus d'écrasement silencieux par « Recatégoriser IA »). Métriques `avg_confidence` + `Ops traitées` agrégées depuis les vrais logs de prédiction (plus d'artefacts 0 ou 100%) |
| **Export Comptable V3** | Grille calendrier 4×3 avec badges toggle PDF+CSV + checkbox Compte d'attente, génération ZIP (PDF+CSV+relevés+justificatifs+compte_attente en dossiers), exports enregistrés dans la GED, historique trié par mois (jan→déc) avec expander contenu ZIP, sélection multi-export, envoi au comptable |
| **Compte d'Attente** | Export PDF/CSV des opérations en attente par mois ou année, **filtres catégorie + sous-catégorie** (liste complète du référentiel, reset auto, compteur), bouton export dropdown (4 options), enregistrement automatique dans la GED, cas 0 ops = fichier preuve |
| **Email Comptable** | Drawer universel d'envoi au comptable via SMTP Gmail : sélection documents multi-type triés par période, filtres, **expanders intelligents**, **pré-sélection intelligente**, **jauge taille temps réel**, **template HTML brandé** (logo lockup, filets violets, arborescence ZIP, signature, footer copyright), **toggle HTML/Texte** dans le drawer, ZIP unique en PJ, historique des envois (champ `mode: "smtp" \| "manual"`). **Mode envoi manuel** (fallback Gmail) : bouton secondaire « Préparer envoi manuel » sous le SMTP — backend génère ZIP persistant `data/exports/manual/`, frontend copie le corps dans le presse-papier + ouvre Finder (`open -R`) + lance `mailto:` (objet seul, corps ne passe **jamais** dans `?body=`), section repliable « ZIPs préparés (N) » avec actions Finder/Recopier/Envoyé/🗑, cleanup auto 30j (boucle asyncio coopérative `shutdown_event`), section Settings > Stockage avec compteur live + bouton « Vider », couverture mensuelle considère `mode in (smtp, manual)`, indépendance SMTP totale (aucun app password requis) |
| **OCR** | Point d'entrée justificatifs : **5 onglets** (**Sandbox** en 1er Session 29 / Upload / Test manuel / **Gestion OCR** renommée depuis Historique / Templates). **Onglet Sandbox = boîte d'arrivée** : les fichiers déposés dans `data/justificatifs/sandbox/` dont le nom n'est pas canonique (`fournisseur_YYYYMMDD_montant.XX.pdf`) **restent sur disque** et apparaissent dans cet onglet pour correction manuelle (rename inline ↵/⇧↵/Esc/⌘⌫ + `[Lancer OCR]`). Les fichiers canoniques sont traités automatiquement comme avant (watchdog conditionnel). Mode auto optionnel : OCR après délai configurable (15-300s, off par défaut). Badge sidebar OCR amber = nombre de fichiers dans la sandbox. **Sandbox est strictement hors GED** : aucune scan d'intégrité, aucun référencement, thumbnails dans cache séparé `data/sandbox_thumbs/`. Batch upload multi-fichiers + OCR automatique (EasyOCR), **auto-rename** post-OCR filename-first (`fournisseur_YYYYMMDD_montant.XX.pdf`, suffix `_fs` pour les fac-similés), **FilenameEditor** inline-editable, **Gestion OCR** = tableau des fichiers OCR avec tri `scan_date` (processed_at) / date (best_date) / supplier / confidence, filtre association (tous/sans/avec), **recherche multifocale** (libellé/catégorie/montant/fournisseur, accent-insensitive, debounce 250ms), **bouton crayon par ligne** → `OcrEditDrawer` 720px — édition supplier/date/montant + cat/sous-cat + **sélecteur d'opération refondu** (dropdown custom riche avec filtre par mois du justif via chip bleu « Avril 2025 » cliquable, recherche textuelle intégrée, items avec date/libellé/montant/badge catégorie violet/icône Check si sélectionné, montants en tabular-nums vert si crédit, état vide avec bouton « Voir toute l'année »), **nom canonique affiché en live** sous les champs (code mono emerald si nouveau nom, gris + badge « déjà conforme » si identique, ambre si données manquantes), sub-drawer preview PDF, accessible aussi **depuis GED** via badge « Mal nommé ? Éditer OCR » / bouton Actions dans `GedDocumentDrawer`, **bouton orange « Scanner & Renommer »** → `ScanRenameDrawer` avec `SkippedItemEditor` inline + chainage auto-rapprochement post-apply, **badge ambre « Pseudo-canonique »** (Session 28) sur les rows dont le filename matche l'ancienne regex permissive mais pas la nouvelle (suffix timestamp sandbox `_20260417_104502`) — clic → `OcrEditDrawer`. **Rename inline** avec gestion collision cross-location : même MD5 → dédup auto (toast « Doublon supprimé »), hash différent → toast custom avec bouton « Utiliser {suggestion} » qui relance la mutation, **flux 2 toasts** à l'arrivée d'un nouveau fichier sandbox : (1) toast `loading` neutre « Analyse en cours… » dès le move → en_attente (avant OCR), (2) toast riche `SandboxArrivalToast` en fin de pipeline — **variante verte « Associé automatiquement »** avec bloc op (libellé + date + montant) + pill `🔒 LOCKED` si score ≥ 0.95, ou variante violette classique « Nouveau scan reçu » si aucune auto-association. Dédup cross-reload via `event_id = filename@timestamp@status`, rejeu SSE au connect depuis un ring buffer + scan disque `en_attente/` + `traites/` (fenêtre 180s), **templates justificatifs** avec recherche + filtres, **hints comptables** (category_hint/sous_categorie_hint) auto-écrits dans `.ocr.json` sur associate et lus en priorité par score_categorie, **hover popover 300×400 en `<img>` thumbnail PNG** (plus d'iframe PDF qui se décharge en grille) |
| **Templates** | Bibliothèque de templates par fournisseur avec preview PDF, génération de justificatifs reconstitués (**fac-similé** du PDF source avec remplacement date/montant, ou PDF sobre en fallback), extraction auto des coordonnées via pdfplumber, suggestion automatique par alias ou catégorie, **batch fac-similé** (multi-ops groupées par template, endpoint `batch-suggest` + `batch-generate`), **création depuis PDF vierge** (flag `is_blank_template`, pas d'OCR, click-to-position sur l'aperçu pour placer date/montant en points PDF), **champ `taux_tva` persistable** (10% restauration / 5,5% alimentation / 20% standard / 0% exonéré) dans les 2 drawers (création + édition) utilisé pour ventiler auto TTC/HT/TVA, **substitution de placeholders dans blank templates** (détection `{KEY}`/`(KEY)` via text layer pdfplumber, substitution inline à la position exacte : `DATE_FR`, `MONTANT_TTC`, `MONTANT_HT`, `MONTANT_TVA`, `TAUX_TVA`, `FOURNISSEUR`, `REF_OPERATION`), **propagation automatique des hints catégorie** dans le `.ocr.json` généré (boost rapprochement), **administration cross-module via l'axe Templates de la GED** (bibliothèque dédiée avec filtres AFFICHAGE/CATÉGORIE, drawer détail listant les fac-similés générés) |
| **GED V2** | Hub documentaire unifie : **6 vues arbre** (periode, annee/type, categorie, fournisseur, type, **templates**), **`GedSearchBar` pleine largeur** au-dessus du split (search + montant min/max + toggle filtres avancés Type/Catégorie/Sous-cat/Fournisseur/Période, **chips actifs colorés** par type de filtre, compteur résultats, cascade catégorie → sous-catégorie, backend `montant_min`/`montant_max` avec fallback `montant \|\| montant_brut`), cartes enrichies avec **badges overlay sur thumbnails justificatifs** (statut amber/vert "En attente"/"Associé" top-right, montant bottom-left, date bottom-right — tous en `bg-black/55` ou chip coloré), justificatifs traités ET en attente, rapports intégrés (favori, re-génération, comparaison, **suppression**), enrichissement auto metadata via rapprochement/OCR/éditeur/nom de fichier, postes comptables avec % déductibilité, recherche full-text enrichie, URL params (`?axis=templates` supporté), **navigation bidirectionnelle** justificatif ↔ opération avec 2 boutons dans le drawer (« Voir dans Justificatifs » + « Ouvrir dans l'Éditeur » via prop `showEditorLink`), **édition OCR depuis GED** : badge ambre « Mal nommé ? Éditer OCR » dans le header + bouton « Éditer données OCR » dans les Actions → ouvre `OcrEditDrawer` en overlay avec fallback synthétique si pas d'OCR, **suppression propre** du justificatif avec toast détaillé (PDF + thumbnail + GED + liens ops + cache), **thumbnails invalidées** automatiquement à chaque move/rename/delete (plus d'orphelins), **sous-drawer preview grand format** (thumbnail cliquable + overlay « Agrandir » → `GedPreviewSubDrawer` slide depuis la droite, positionné à gauche du main drawer), **tooltips riches** au survol des onglets du panneau tree (fond blanc/texte noir/bordure, titre + description), **tree repliée par défaut** (zéro bruit visuel au chargement, l'utilisateur ouvre ce qu'il veut voir), **axe Templates** (bibliothèque des templates fac-similé : grille de cartes avec filtres AFFICHAGE/CATÉGORIE, drawer détail 600px avec aperçu/infos éditables/champs readonly/liste fac-similés générés cliquables, boutons Éditer/Générer en batch/Supprimer avec confirmation enrichie préservant les fac-similés) |
| **Amortissements** | Registre immobilisations, calcul dotations linéaire **strict BNC** (dégressif legacy en lecture seule), détection auto candidates (> 500€, strict `Catégorie == "Matériel"`), plafonds véhicules CO2, cessions avec plus/moins-value, moteur calcul temps réel, **reprise d'exercice antérieur** (3 champs `exercice_entree_neuronx` + `amortissements_anterieurs` + `vnc_ouverture` avec auto-suggestion `compute-backfill`), **OD dotation au 31/12** générable depuis le module : PDF rapport multi-format (PDF/CSV/XLSX) ReportLab paysage A4 avec **colonne `Origine`** (NeuronX / Reprise badge ambre), tableau registre, totaux violet, art. 39-1-2° CGI + entrée GED + intégration export ZIP (3 fichiers `Amortissements/` strictement identiques à ceux servis via `/reports`), idempotent, task auto `dotation_manquante` HIGH si exercice clos sans OD. **Anti-duplication B3** : OD/ZIP/UI Rapports consomment 2 templates unifiés (`amortissements_registre`, `amortissements_dotations`) via `report_service.get_or_generate` — 1 PDF, 1 entrée GED, 1 fichier disque par couple `(filters, format)`. Suppression de l'OD préserve le PDF du rapport (vit sa vie en GED) |
| **Charges forfaitaires** | 2 onglets (Blanchissage + Véhicule) avec badges pill colorés. **Blanchissage** : barème éditable, calcul OD + PDF rapport, GED. **Véhicule** : quote-part pro kilométrique (aller-retour × jours + km sup / km totaux), calcul live côté client, mise à jour poste GED, PDF rapport avec tableau dépenses par sous-catégorie, auto-regénération. Aperçu PDF via thumbnail PNG + drawer 700px. Intégré dans Simulation BNC |
| **Prévisionnel** | Calendrier de trésorerie 12 mois : timeline charges/recettes (barres Recharts), fournisseurs récurrents (facture/échéancier), parsing OCR prélèvements, scan automatique documents, régression recettes + saisonnalité, paramètres catégories |
| **Simulation BNC** | Simulateur fiscal : leviers Madelin/PER/CARMF/investissement/remplacement, dépenses détaillées par catégorie, taux marginal réel, comparatif charge/immobilisation, prévisions d'honoraires avec profil saisonnier |
| **URSSAF Déductible** | Calcul automatique part déductible vs non déductible CSG/CRDS (2,9%) sur les cotisations URSSAF. Assiette ≤2024 BNC+cotis, ≥2025 BNC×74% (réforme). **Formule pro-rata** : non-déductible annuel `= assiette × 2,9 %` réparti au pro-rata des paiements URSSAF de l'année. Widget inline dans l'éditeur + batch année complète depuis Compta Analytique. **Auto-run au lifespan boot** pour `[N−2, N−1, N]` (idempotent grâce au skip natif). Déduit automatiquement du BNC dans les analytics et exports |
| **Anticipation régul URSSAF** | Anticipe l'écart entre URSSAF dû sur le BNC réel de N et URSSAF effectivement payée en cash en N — l'écart correspond à la régul versée typiquement en octobre/novembre N+1 (ou remboursement si BNC en baisse). 3 surfaces complémentaires : (1) **section drawer Compta Analytique > URSSAF** « Régularisation URSSAF estimée » avec écart `+X € (vert, remboursement)` ou `−X € (rouge, à payer)` + badge `definitif`/`provisoire` ; (2) **panel Simulation BNC > Prévisions** « Projection cotisations URSSAF » sur 5 années (BNC réel ou forecast) avec acompte théorique calculé sur BNC N-2 ; (3) **Prévisionnel** : champ `type_cotisation` sur les providers (Standard / URSSAF acompte / URSSAF régul) avec injection automatique du montant calculé sur BNC N-2 dans la timeline + badges `Acompte` cyan / `Régul N−1` ambre. **Auto-task `urssaf_regul_alert`** (8e détection) : alerte priority haute si delta BNC N vs N-2 ≥ 30 % et écart régul ≥ 1 000 €. Endpoints `/api/simulation/urssaf-regul/{year}`, `/urssaf-acompte-theorique/{year}`, `/urssaf-projection?start_year=&horizon=` |
| **Tâches** | Vue kanban 3 colonnes (To do / In progress / Done) avec drag & drop et **réordonnancement vertical** intra-colonne (persisté), tâches auto-générées (5 détections : catégorisation, justificatifs, clôture, imports, alertes) + tâches manuelles, scopé par année, badge compteur sidebar |
| **Paramètres** | Thème, export, stockage, informations système, **email comptable** (SMTP Gmail, app password, destinataires, nom expéditeur), **Intégrité des justificatifs** (scan + répare auto duplicatas/orphelins/liens fantômes/**ventilation à reconnecter** — passe systémique qui reconnecte les orphans `traites/` à une sous-ligne ventilée vide si date + montant matchent exactement, auto-healing post-split/merge au boot via le lifespan), grille 7 métriques, détection conflits hash, bouton « Redémarrer backend » en dev |

---

## Stack Technique

### Frontend
- **React 19** + TypeScript 5
- **Vite 8** (bundler)
- **TailwindCSS 4** (dark theme)
- **TanStack Query 5** (data fetching & cache)
- **TanStack Table 8** (tableaux)
- **Recharts 3** (graphiques)
- **Lucide React** (icônes)
- **Zustand** (state management global, année persistée)
- **@dnd-kit** (drag & drop kanban)

### Backend
- **FastAPI** (Python 3.9+)
- **pandas** + **numpy** (traitement de données)
- **scikit-learn** (ML catégorisation)
- **EasyOCR** + **pdf2image** (reconnaissance optique)
- **ReportLab** + **openpyxl** (génération PDF/Excel)
- **pdfplumber** (extraction PDF)

### Stockage
- Fichiers JSON dans `data/` (opérations, catégories, paramètres)
- Imports séparés : `data/imports/operations/` (JSON) et `data/imports/releves/` (PDF)
- Modèles ML en pickle (`data/ml/`)
- Cache OCR en `.ocr.json`
- Justificatifs PDF dans `data/justificatifs/`
- ZIPs envoi manuel dans `data/exports/manual/` (mode fallback Gmail, cleanup 30j auto)

---

## Installation

### Prérequis
- Python 3.9+
- Node.js 18+
- Poppler (pour pdf2image) : `brew install poppler`

### Lancement rapide (recommandé) — `./start.sh`

```bash
./start.sh
```

Lance en parallèle le backend (port 8000) et le frontend (port 5173) avec les flags uvicorn optimisés :
- `--timeout-graceful-shutdown 2` — force le kill du worker après 2s sur un reload (évite le blocage « Waiting for connections to close » dû aux SSE `/api/sandbox/events` + thread watchdog + tâche `_previsionnel_background_loop`)
- `--reload-exclude 'data/*' 'frontend/*' '*.pkl' '*.log' 'backups/*' '__pycache__/*'` — ignore les reloads parasites déclenchés quand le backend écrit dans `data/` (ex. `save_rules_model`, `log_prediction_batch`)

`Ctrl+C` kille les deux processus. Backend Swagger sur **http://localhost:8000/docs**, frontend sur **http://localhost:5173**.

#### Filet de sécurité ports (zombies uvicorn)

Un worker uvicorn peut parfois survivre à `--timeout-graceful-shutdown 2` (handler SSE, watchdog ou boucle asyncio bloqué) et garder le LISTEN sur `:8000` sans répondre. `start.sh` gère ce cas automatiquement :

- **Pre-kill au boot** — `start.sh` libère les ports 8000 et 5173 avant de démarrer (silencieux si rien à tuer).
- **Trap `EXIT/INT/TERM`** — la fonction `cleanup()` libère les ports à toute sortie du script (Ctrl+C, `kill`, exit normal) via `lsof -ti` + `pkill -9 -f "uvicorn backend.main"` + `pkill -9 -f "vite"`.

Reset manuel si besoin (ex. une session précédente kill -9'ée à la volée) :

```bash
./kill-ports.sh
```

### Lancement manuel (2 terminaux séparés)

#### Backend

```bash
# Créer un environnement virtuel (recommandé)
python3 -m venv venv
source venv/bin/activate

# Installer les dépendances
pip install -r backend/requirements.txt

# Lancer le serveur (mêmes flags que start.sh)
python3 -m uvicorn backend.main:app \
  --host 0.0.0.0 --port 8000 \
  --reload \
  --timeout-graceful-shutdown 2 \
  --reload-exclude 'data/*' --reload-exclude 'frontend/*' \
  --reload-exclude '*.pkl' --reload-exclude '*.log'
```

Le backend tourne sur **http://localhost:8000**. Documentation Swagger sur `/docs`.

#### Frontend

```bash
cd frontend

# Installer les dépendances
npm install

# Lancer le serveur de développement
npm run dev
```

Le frontend tourne sur **http://localhost:5173**. Le proxy API est configuré automatiquement vers le port 8000.

---

## Structure du Projet

```
neuronXcompta/
├── backend/
│   ├── main.py                 # Point d'entrée FastAPI
│   ├── requirements.txt        # Dépendances Python
│   ├── core/
│   │   └── config.py           # Configuration centralisée
│   ├── models/                 # Schémas Pydantic (14 fichiers)
│   │   ├── category.py
│   │   ├── justificatif.py
│   │   ├── ocr.py
│   │   ├── operation.py
│   │   ├── settings.py
│   │   ├── ged.py
│   │   ├── report.py
│   │   ├── analytics.py
│   │   ├── amortissement.py
│   │   └── ...
│   ├── routers/                # Endpoints API (20 fichiers)
│   │   ├── operations.py
│   │   ├── categories.py
│   │   ├── ml.py
│   │   ├── analytics.py
│   │   ├── settings.py
│   │   ├── reports.py
│   │   ├── queries.py
│   │   ├── justificatifs.py
│   │   ├── ocr.py
│   │   ├── exports.py
│   │   ├── ged.py
│   │   ├── amortissements.py
│   │   └── ...
│   └── services/               # Logique métier (19 fichiers)
│       ├── operation_service.py
│       ├── category_service.py
│       ├── ml_service.py
│       ├── analytics_service.py
│       ├── report_service.py
│       ├── query_service.py
│       ├── justificatif_service.py
│       ├── ocr_service.py
│       ├── export_service.py
│       ├── pdf_service.py
│       ├── rapprochement_service.py
│       ├── sandbox_service.py     # Inbox + watchdog conditionnel + rename inplace
│       ├── sandbox_auto_processor.py  # Loop asyncio OCR auto après délai (off par défaut)
│       └── cloture_service.py
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx             # Routes (16 pages)
│       ├── main.tsx            # Point d'entrée React
│       ├── index.css           # Thème Tailwind
│       ├── api/client.ts       # Client API
│       ├── components/         # 60+ composants React
│       ├── hooks/              # 18 fichiers de hooks
│       ├── types/index.ts      # Types TypeScript
│       └── lib/utils.ts        # Utilitaires
├── data/                       # Données applicatives
│   ├── imports/
│   │   ├── operations/         # Fichiers JSON d'opérations
│   │   └── releves/            # Relevés bancaires PDF
│   ├── exports/                # Archives ZIP générées
│   ├── reports/                # Rapports générés
│   ├── justificatifs/          # Justificatifs PDF
│   │   ├── en_attente/
│   │   └── traites/
│   ├── ged/                    # Bibliothèque GED
│   │   ├── ged_metadata.json
│   │   ├── ged_postes.json
│   │   └── thumbnails/
│   ├── amortissements/         # Registre immobilisations
│   │   ├── immobilisations.json
│   │   └── config.json
│   ├── previsionnel/           # Prévisionnel trésorerie
│   │   ├── providers.json
│   │   ├── echeances.json
│   │   └── settings.json
│   ├── templates/              # Templates justificatifs
│   │   └── justificatifs_templates.json
│   ├── tasks.json              # Tâches kanban (auto + manuelles)
│   ├── ml/                     # Modèles ML
│   └── logs/                   # Logs applicatifs
├── settings.json               # Configuration utilisateur
├── CLAUDE.md                   # Guide pour Claude Code
└── docs/                       # Documentation technique
```

---

## API

L'API REST est documentée automatiquement via **Swagger UI** sur `http://localhost:8000/docs`.

### Principaux endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/operations/files` | Lister les fichiers d'opérations |
| `POST` | `/api/operations/import` | Importer un relevé PDF |
| `POST` | `/api/ml/predict` | Prédire la catégorie d'un libellé |
| `POST` | `/api/ml/train` | Entraîner le modèle ML |
| `GET` | `/api/analytics/dashboard` | Données du tableau de bord |
| `POST` | `/api/reports/generate` | Générer un rapport (CSV/PDF/Excel) |
| `POST` | `/api/reports/export-zip` | Exporter rapports sélectionnés en ZIP |
| `POST` | `/api/reports/regenerate-all` | Régénérer tous les rapports |
| `POST` | `/api/reports/{filename}/open-native` | Ouvrir dans Aperçu/Numbers |
| `DELETE` | `/api/reports/all` | Supprimer tous les rapports |
| `POST` | `/api/exports/generate` | Générer un export comptable ZIP (legacy) |
| `GET` | `/api/exports/status/{year}` | Statut mensuel des exports (has_pdf, has_csv, preview contenu) |
| `POST` | `/api/exports/generate-month` | Générer un export mensuel (PDF+CSV+relevés+rapports+justificatifs) |
| `POST` | `/api/exports/generate-batch` | Générer un batch d'exports (ZIP multi-mois) |
| `GET` | `/api/exports/contents/{filename}` | Lister les fichiers dans un ZIP d'export |
| `GET` | `/api/exports/available-reports/{year}/{month}` | Rapports disponibles pour un mois |
| `POST` | `/api/email/test-connection` | Tester la connexion SMTP Gmail |
| `GET` | `/api/email/documents` | Lister les documents disponibles pour envoi (filtres type/année/mois) |
| `POST` | `/api/email/preview` | Prévisualisation email (objet + corps auto-générés) |
| `POST` | `/api/email/send` | Envoyer des documents par email (ZIP unique + HTML avec logo) |
| `GET` | `/api/email/history` | Historique des envois email (champ `mode` discrimine smtp/manual) |
| `GET` | `/api/email/coverage/{year}` | Couverture d'envoi par mois pour une année (filtre `mode in (smtp, manual)`) |
| `POST` | `/api/email/prepare-manual` | **Mode manuel** : génère un ZIP persistant + retourne objet/corps pré-remplis |
| `GET` | `/api/email/manual-zips` | **Mode manuel** : lister les ZIPs préparés non encore envoyés |
| `GET` | `/api/email/manual-zips/stats` | **Mode manuel** : métriques d'usage (pending_count, taille disque, sent_count) |
| `POST` | `/api/email/manual-zips/cleanup?max_age_days=` | **Mode manuel** : purge des ZIPs > N jours (0 = tout supprimer) |
| `POST` | `/api/email/manual-zips/{id}/open-native` | **Mode manuel** : révèle le ZIP dans Finder (`open -R`) |
| `POST` | `/api/email/manual-zips/{id}/mark-sent` | **Mode manuel** : ajoute entrée historique `mode=manual` + supprime ZIP physique |
| `DELETE` | `/api/email/manual-zips/{id}` | **Mode manuel** : supprime ZIP physique + entrée index |
| `POST` | `/api/ocr/extract` | Extraction OCR d'un justificatif |
| `POST` | `/api/ocr/batch-upload` | Upload batch + OCR de justificatifs |
| `GET` | `/api/analytics/compare` | Comparatif entre 2 périodes |
| `GET` | `/api/analytics/category-detail` | Drill-down catégorie |
| `POST` | `/api/rapprochement/run-auto` | Rapprochement automatique |
| `POST` | `/api/rapprochement/associate-manual` | Association manuelle (supporte `ventilation_index` + `force: bool` pour bypass lock ; set `locked=true` auto après succès ; 423 si op déjà lockée sans `force`) |
| `PATCH` | `/api/operations/{filename}/{index}/lock` | Verrouiller/déverrouiller une opération — body `{locked: bool}` → `{locked, locked_at}`. Protège l'association justif contre l'auto-rapprochement |
| `POST` | `/api/justificatifs/dissociate` | Dissocier — 423 si op lockée (déverrouillage requis) |
| `DELETE` | `/api/justificatifs/{filename}` | Suppression complète : retourne dict détaillé (`ops_unlinked`, `thumbnail_deleted`, `ged_cleaned`, `ocr_cache_deleted`) |
| `PUT` | `/api/ventilation/{file}/{idx}` | Créer/modifier ventilation — lance auto-rapprochement en arrière-plan sur les sous-lignes |
| `GET` | `/api/justificatifs/scan-links` | Dry-run : liste incohérences disque ↔ ops (duplicatas, orphelins, ghosts, conflits) |
| `POST` | `/api/justificatifs/repair-links` | Apply : répare duplicatas/orphelins/ghosts, skip conflits hash |
| `GET` | `/api/settings` | Charger les paramètres |
| `POST` | `/api/settings/restart` | Redémarrer le backend (dev, touch sentinel uvicorn --reload) |
| `GET` | `/api/analytics/year-overview` | Cockpit annuel (mois, KPIs, alertes, progression) |
| `GET` | `/api/reports/tree` | Arbre triple vue (année/catégorie/format) |
| `GET` | `/api/reports/templates` | Templates de rapports prédéfinis |
| `GET` | `/api/ged/tree` | Arbre GED (par année / par type) |
| `GET` | `/api/ged/documents` | Documents indexés avec filtres |
| `GET` | `/api/amortissements` | Registre des immobilisations |
| `GET` | `/api/amortissements/kpis` | KPIs amortissements |
| `GET` | `/api/amortissements/candidates` | Opérations candidates à immobiliser |
| `GET` | `/api/amortissements/virtual-detail?year=` | Détail dotations annuelles par immo (Prompt A2) |
| `GET` | `/api/amortissements/dotation-ref/{year}` | Référence OD dotation (filename + index) ou null |
| `POST` | `/api/amortissements/compute-backfill` | Suggestion `amortissements_anterieurs` + `vnc_ouverture` (reprise) |
| `POST` | `/api/amortissements/generer-dotation?year=` | **Prompt B1** : OD 31/12 + PDF + GED (idempotent) |
| `DELETE` | `/api/amortissements/supprimer-dotation?year=` | **Prompt B1** : nettoie OD + PDF + GED |
| `POST` | `/api/amortissements/regenerer-pdf-dotation?year=` | **Prompt B1** : regénère PDF (pattern véhicule) |
| `GET` | `/api/amortissements/candidate-detail?filename=&index=` | **Prompt B1** : op + justif + préfill OCR (pour Prompt B2) |
| `GET` | `/api/amortissements/dotation-genere?year=` | **Prompt B1** : métadonnées OD si générée, sinon null |
| `GET` | `/api/previsionnel/timeline` | Timeline 12 mois charges/recettes/solde |
| `GET` | `/api/previsionnel/providers` | Fournisseurs récurrents configurés |
| `POST` | `/api/previsionnel/scan` | Scanner documents OCR/GED vs échéances |
| `POST` | `/api/previsionnel/refresh` | Régénérer les échéances de l'année |
| `GET` | `/api/previsionnel/dashboard` | KPIs prévisionnel |
| `GET` | `/api/templates` | Lister les templates justificatifs |
| `POST` | `/api/templates` | Créer un template fournisseur (depuis justificatif scanné) |
| `POST` | `/api/templates/from-blank` | Créer un template depuis un PDF vierge (pas d'OCR) |
| `POST` | `/api/templates/extract` | Extraire les champs d'un justificatif scanné |
| `POST` | `/api/templates/generate` | Générer un PDF justificatif reconstitué |
| `GET` | `/api/templates/suggest/{file}/{idx}` | Suggestions de templates pour une opération |
| `GET` | `/api/templates/ged-summary` | Liste enrichie pour la GED (compteurs fac-similés) |
| `GET` | `/api/templates/{id}/ged-detail` | Détail + fac-similés générés pour le drawer GED |
| `GET` | `/api/templates/{id}/thumbnail` | Thumbnail PNG 200px d'un blank template |
| `GET` | `/api/templates/{id}/page-size` | Dimensions de page pt PDF (click-to-position) |
| `GET` | `/api/tasks/?year=` | Lister les tâches pour une année |
| `POST` | `/api/tasks/` | Créer une tâche manuelle |
| `PATCH` | `/api/tasks/{id}` | Modifier une tâche (status, priority, dismiss) |
| `POST` | `/api/tasks/refresh?year=` | Régénérer les tâches auto pour l'année |
| `PUT` | `/api/settings` | Sauvegarder les paramètres (incl. `auto_pointage`) |
| `GET` | `/api/justificatifs/reverse-lookup/{file}` | Trouver les opérations liées à un justificatif |
| `GET` | `/api/sandbox/list` | Liste enrichie des fichiers sandbox (`is_canonical`, `arrived_at`, `auto_deadline`) |
| `POST` | `/api/sandbox/{filename}/rename` | Rename inplace (Session 29, avant OCR) |
| `POST` | `/api/sandbox/{filename}/process` | Déclencher OCR + rapprochement à la demande (Session 29) |
| `GET` | `/api/sandbox/{filename}/thumbnail` | Vignette PNG (cache séparé `data/sandbox_thumbs/`, hors GED) |
| `GET` | `/api/sandbox/{filename}/preview` | Stream PDF inline |
| `POST` | `/api/sandbox/process-all` | Traiter tous les fichiers canoniques (renommé depuis `/process`, Session 29) |
| `DELETE` | `/api/sandbox/{filename}` | Supprimer un fichier sandbox sans le traiter |

---

## Développement

### Preview Claude sur ports alternatifs

`.claude/launch.json` configure le preview Claude sur des ports dédiés pour cohabiter avec `./start.sh` :

- **Preview backend** : `:8100` (vs `:8000` pour `start.sh`)
- **Preview frontend** : `:5273` (vs `:5173` pour `start.sh`)
- **`VITE_API_URL`** (env) — `frontend/vite.config.ts` proxy target configurable. Défaut `http://127.0.0.1:8000` (pour `start.sh` standard). Le preview Claude fixe `VITE_API_URL=http://127.0.0.1:8000` → cohabite avec un backend `start.sh` local sans conflit.

### Build production

```bash
cd frontend
npm run build    # Génère frontend/dist/
```

### Vérification TypeScript

```bash
cd frontend
npx tsc --noEmit
```

### Linting

```bash
cd frontend
npm run lint
```

---

## Licence

Projet privé - Usage interne uniquement.
