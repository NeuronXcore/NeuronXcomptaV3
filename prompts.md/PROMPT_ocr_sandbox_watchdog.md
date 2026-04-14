# Prompt Claude Code — OCR Sandbox Watchdog

## Contexte

NeuronXcompta V3 — application comptable FastAPI + React.

Le pipeline OCR est **partiellement en place** :
- `data/justificatifs/en_attente/` — PDF en attente de rapprochement (avec `.ocr.json`)
- `data/justificatifs/traites/` — PDF associés à une opération
- `backend/services/ocr_service.py` — `extract_or_cached()` déjà fonctionnel
- `backend/core/config.py` — toutes les constantes de chemins centralisées

**Ce qui manque :** un dossier sandbox + un watchdog qui surveille ce dossier et déclenche automatiquement le pipeline OCR dès qu'un PDF y est déposé.

---

## Objectif

Implémenter un **OCR sandbox watchdog** entièrement automatique :

1. L'utilisateur dépose un ou plusieurs PDF dans `data/justificatifs/sandbox/`
2. Le watchdog détecte l'arrivée de chaque fichier (via `watchdog` Python)
3. OCR automatique déclenché (`ocr_service.extract_or_cached()`)
4. Le fichier est déplacé dans `data/justificatifs/en_attente/` avec son `.ocr.json`
5. Le frontend est notifié via un endpoint SSE (`/api/sandbox/events`) pour rafraîchir sa liste

---

## Travail demandé

### 1. `backend/core/config.py`

Ajouter la constante manquante :

```python
JUSTIFICATIFS_SANDBOX_DIR = DATA_DIR / "justificatifs" / "sandbox"
```

S'assurer que `ensure_directories()` crée ce dossier s'il n'existe pas.

---

### 2. `backend/services/sandbox_service.py` (nouveau fichier)

Créer un service watchdog avec les responsabilités suivantes :

- **`SandboxWatchdog`** : classe qui utilise `watchdog.observers.Observer` + un `FileSystemEventHandler` custom
- Surveille `JUSTIFICATIFS_SANDBOX_DIR` en mode non-récursif
- À chaque `on_created` (fichier `.pdf` uniquement, case-insensitive) :
  - Attendre que le fichier soit complètement écrit (polling `os.path.getsize` stable sur 500ms)
  - Appeler `ocr_service.extract_or_cached(filename)` — **attention : l'OCR travaille sur le dossier `en_attente`, donc déplacer le fichier AVANT l'OCR**
  - Déplacer le PDF de `sandbox/` vers `en_attente/` via `shutil.move`
  - Déclencher l'OCR sur le fichier maintenant dans `en_attente/`
  - Émettre un event SSE dans la queue globale `sandbox_event_queue`
- **`sandbox_event_queue`** : `asyncio.Queue` globale partagée avec le router SSE
- **`start_sandbox_watchdog()`** / **`stop_sandbox_watchdog()`** : lifecycle functions
- Gérer les erreurs proprement (fichier déjà déplacé, OCR échoue) avec logs

Contrainte Python 3.9 : `from __future__ import annotations` en tête de fichier.

---

### 3. `backend/routers/sandbox.py` (nouveau fichier)

Router FastAPI avec les endpoints :

#### `GET /api/sandbox/events` — SSE stream

```
Content-Type: text/event-stream
```

- Utiliser `StreamingResponse` avec un générateur async
- Consommer `sandbox_event_queue` (timeout 30s pour garder la connexion vivante avec un `ping`)
- Chaque event : `data: {"filename": "...", "status": "processed", "timestamp": "..."}` suivi de `\n\n`
- Gérer proprement la déconnexion client

#### `GET /api/sandbox/list` — liste les fichiers en attente dans sandbox

Retourner la liste des PDF actuellement dans `sandbox/` (non encore traités).

#### `DELETE /api/sandbox/{filename}` — supprimer un fichier du sandbox

Supprimer un PDF du sandbox sans le traiter (correction d'erreur de dépôt).

---

### 4. `backend/main.py`

- Importer et inclure le router : `app.include_router(sandbox_router, prefix="/api/sandbox")`
- Utiliser les lifecycle hooks FastAPI (`lifespan`) pour démarrer/arrêter le watchdog :

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    start_sandbox_watchdog()
    yield
    stop_sandbox_watchdog()

app = FastAPI(lifespan=lifespan)
```

Si `lifespan` est déjà utilisé, intégrer dedans.

---

### 5. Frontend — `src/hooks/useSandbox.ts` (nouveau fichier)

Hook React qui :

- Se connecte au SSE `GET /api/sandbox/events` via `EventSource`
- Expose `{ lastEvent, isConnected }`
- À chaque event reçu, invalide les queries TanStack : `['justificatifs']` et `['justificatifs-stats']`
- Nettoyage propre du `EventSource` au unmount

---

### 6. Frontend — intégration dans `JustificatifsPage.tsx`

- Appeler `useSandbox()` dans le composant
- Afficher un badge/indicateur discret en haut de page quand `isConnected` est `true` : `"Sandbox actif — dépôt auto surveillé"`
- Quand un `lastEvent` arrive, afficher un toast (ou une notification inline) : `"1 justificatif traité : {filename}"` avec un rafraîchissement automatique de la liste

---

## Dépendance à installer

```bash
pip install watchdog
```

Ajouter `watchdog>=4.0.0` dans `backend/requirements.txt`.

---

## Contraintes à respecter

- **Python 3.9** : `from __future__ import annotations` dans tous les nouveaux fichiers backend. Utiliser `Optional[X]`, pas `X | None`.
- **Pas de cloud** : tout tourne localement, pas d'appel externe.
- **Gestion des doublons** : si un fichier du même nom existe déjà dans `en_attente/`, ajouter un suffix timestamp avant de déplacer.
- **Thread-safety** : le watchdog tourne dans un thread OS, la queue SSE est asyncio. Utiliser `asyncio.get_event_loop().call_soon_threadsafe()` ou `loop.run_coroutine_threadsafe()` pour pousser dans la queue depuis le thread watchdog.
- **Logs** : utiliser le logger existant du projet (ne pas créer un nouveau système de logs).

---

## Critères de validation

- [ ] Déposer un PDF dans `data/justificatifs/sandbox/` → il apparaît automatiquement dans `en_attente/` avec son `.ocr.json` en moins de 3 secondes
- [ ] Le frontend rafraîchit sa liste sans action utilisateur
- [ ] Déposer 5 PDF simultanément → tous traités sans perte ni corruption
- [ ] Redémarrer le backend → le watchdog repart automatiquement
- [ ] Un PDF non-PDF (`.txt`, `.png`) déposé dans sandbox → ignoré silencieusement
- [ ] `GET /api/sandbox/events` retourne bien du `text/event-stream`

---

## Ordre d'implémentation recommandé

1. `config.py` — ajouter la constante + ensure_directories
2. `sandbox_service.py` — le cœur, tester en isolation
3. `sandbox.py` router — SSE + endpoints utilitaires
4. `main.py` — intégration lifespan
5. `useSandbox.ts` — hook frontend
6. `JustificatifsPage.tsx` — affichage événements

---

## Fichiers à lire avant de commencer

```
backend/core/config.py
backend/services/ocr_service.py
backend/services/justificatif_service.py
backend/routers/justificatifs.py
backend/main.py
frontend/src/hooks/useJustificatifs.ts
frontend/src/App.tsx
```
