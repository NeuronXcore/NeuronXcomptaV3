# Changelog

Toutes les modifications notables de NeuronXcompta sont documentees ici.

Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [Unreleased]

### Added
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
- `backend/core/config.py` : ajout `JUSTIFICATIFS_SANDBOX_DIR` + `ensure_directories()`
- `backend/main.py` : ajout lifespan context manager, import router sandbox
- `frontend/src/components/layout/Sidebar.tsx` : `NAV_SECTIONS` groupee remplace `NAV_ITEMS` plat
- `frontend/src/App.tsx` : fusion route `/` avec DashboardPage, suppression route `/dashboard`
- `frontend/src/hooks/useApi.ts` : tous les hooks analytics acceptent year/quarter/month
- `frontend/src/components/ocr/OcrPage.tsx` : 3 onglets (Upload & OCR, Test Manuel, Historique)
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
