# Mode Envoi Manuel — Drawer Envoi Comptable

## Contexte

L'envoi SMTP Gmail des documents comptables peut être bloqué par les filtres anti-spam de Gmail (`UnsolicitedMessageError`), notamment en présence de pièces jointes ZIP volumineuses. Pour fiabiliser la transmission au comptable sans exposer le LAN, on ajoute un **mode envoi manuel** : le ZIP est généré et conservé sur disque, le mail est pré-rempli (objet + corps dans le presse-papier + `mailto:`), et l'utilisateur joint lui-même le ZIP depuis son client mail.

**Principe :** zéro dépendance externe, zéro exposition réseau. Le comptable n'accède jamais au LAN.

## Comportement attendu

### UI — Drawer Envoi Comptable

Sous le bouton vert "📧 Envoyer par email" actuel, ajouter une section :

```
─── Si l'envoi automatique échoue ───

[💾 Préparer envoi manuel (ZIP + mail pré-rempli)]
```

Et plus bas, une section repliable **"ZIPs préparés (N)"** affichant les ZIPs en attente d'envoi manuel. Chaque carte :

- Nom du ZIP, taille, date de préparation (relative : "il y a 2h")
- Boutons : `[📂 Finder]` `[📋 Recopier mail]` `[✓ Marquer envoyé]` `[🗑]`

### Action "Préparer envoi manuel"

1. Backend génère le ZIP dans `data/exports/manual/`
2. Frontend reçoit `ManualPrep` avec `id`, `corps_plain`, `objet`, `zip_filename`
3. Frontend en parallèle :
   - `navigator.clipboard.writeText(result.corps_plain)` → toast "Corps copié"
   - `POST /api/email/manual-zips/{id}/open-native` → ouvre Finder sur le ZIP
   - `window.location.href = mailto:dest?subject=...` (objet uniquement, le corps est dans le clipboard)
4. Toast multi-ligne : `"✓ ZIP ouvert dans Finder · Corps du mail copié · Colle-le dans le brouillon (⌘V)"`
5. Refresh `manualZips`

### Action "Recopier mail" (sur une carte ZIP préparé)

Re-copie le corps dans le clipboard + ré-ouvre `mailto:`. Utile si l'utilisateur a fermé son brouillon par erreur.

### Action "Marquer envoyé"

`POST /api/email/manual-zips/{id}/mark-sent` → ajoute une entrée dans `email_history.json` avec `mode: "manual"`, statut `envoye_manuel`. La carte disparaît de la liste "ZIPs préparés".

### Cleanup

- Les ZIPs préparés non marqués envoyés depuis >30 jours sont supprimés par une tâche APScheduler quotidienne
- Bouton "Vider les ZIPs préparés" dans Paramètres > Stockage

### Couverture mensuelle

`GET /api/email/coverage/{year}` doit considérer comme envoyés les mois ayant au moins une entrée `email_history.json` avec `mode: "smtp"` OU `mode: "manual"`.

## Modèles Pydantic

Dans `backend/models/email.py` :

```python
from typing import Optional, Literal

class ManualPrep(BaseModel):
    id: str  # UUID short
    zip_filename: str
    zip_path: str  # path absolu
    taille_mo: float
    contenu_tree: list[str]  # liste plate des fichiers dans le ZIP
    objet: str
    corps_plain: str
    destinataires: list[str]
    prepared_at: datetime
    sent: bool = False  # devient True après mark-sent

class ManualPrepRequest(BaseModel):
    documents: list[DocumentRef]
    destinataires: list[str]
    objet: Optional[str] = None  # auto-généré si None
    corps: Optional[str] = None  # auto-généré si None

# Étendre EmailHistoryEntry existant
class EmailHistoryEntry(BaseModel):
    # ... champs existants ...
    mode: Literal["smtp", "manual"] = "smtp"  # rétrocompatible : défaut smtp
```

## Service backend

Dans `backend/services/email_service.py` :

```python
MANUAL_ZIPS_DIR = Path("data/exports/manual")
MANUAL_INDEX_PATH = MANUAL_ZIPS_DIR / "_index.json"

def prepare_manual_zip(req: ManualPrepRequest) -> ManualPrep:
    """
    Génère le ZIP en data/exports/manual/, sauve metadata dans _index.json.
    Réutilise _create_zip() existant et generate_email_body_plain().
    """
    # 1. Résolution chemins (réutilise _resolve_document_path)
    # 2. Création ZIP avec timestamp dans le nom
    # 3. Génération objet/corps si None
    # 4. Construction ManualPrep, ajout dans _index.json (écriture atomique)
    # 5. Retour

def list_manual_zips() -> list[ManualPrep]:
    """Lit _index.json, filtre les sent=False, vérifie existence physique du ZIP."""

def get_manual_zip(zip_id: str) -> Optional[ManualPrep]:
    """Lookup par id."""

def open_manual_zip_in_finder(zip_id: str) -> None:
    """subprocess.run(['open', '-R', zip_path]) sur macOS."""
    # Réutilise pattern existant des rapports (open-native)

def mark_manual_zip_sent(zip_id: str) -> EmailHistoryEntry:
    """
    1. Charge ManualPrep
    2. Crée EmailHistoryEntry avec mode='manual', statut='envoye_manuel'
    3. Append dans email_history.json (via email_history_service)
    4. Marque sent=True dans _index.json
    5. Retourne l'entrée d'historique créée
    """

def delete_manual_zip(zip_id: str) -> None:
    """Supprime ZIP physique + entrée dans _index.json."""

def cleanup_old_manual_zips(max_age_days: int = 30) -> int:
    """Supprime les ZIPs non envoyés > max_age_days. Retourne le nombre supprimé."""
    # Appelé par APScheduler quotidiennement (ajouter dans task_service ou scheduler existant)
```

**`_index.json` structure :**
```json
{
  "version": 1,
  "zips": [
    {
      "id": "abc123",
      "zip_filename": "Documents_Comptables_2026-03_2026-04-27_14-32.zip",
      "zip_path": "/abs/path/.../manual/...",
      "taille_mo": 12.4,
      "contenu_tree": ["exports/...", "rapports/..."],
      "objet": "...",
      "corps_plain": "...",
      "destinataires": ["..."],
      "prepared_at": "2026-04-27T14:32:00",
      "sent": false
    }
  ]
}
```

## Endpoints

Dans `backend/routers/email.py` :

```python
@router.post("/prepare-manual", response_model=ManualPrep)
def prepare_manual(req: ManualPrepRequest): ...

@router.get("/manual-zips", response_model=list[ManualPrep])
def list_manual(): ...

@router.post("/manual-zips/{zip_id}/open-native")
def open_in_finder(zip_id: str): ...

@router.post("/manual-zips/{zip_id}/mark-sent", response_model=EmailHistoryEntry)
def mark_sent(zip_id: str): ...

@router.delete("/manual-zips/{zip_id}")
def delete_manual(zip_id: str): ...

@router.post("/manual-zips/cleanup")
def cleanup_manual(max_age_days: int = 30): ...
```

**⚠ Ordre des routes FastAPI :** `/manual-zips/{id}/...` (spécifiques) avant tout `/{filename}` dynamique. Si pas de conflit dans `email.py`, RAS.

**Mise à jour `GET /coverage/{year}` :** dans `email_history_service.get_send_coverage()`, considérer comme envoyés les mois ayant au moins une entrée avec `mode in ("smtp", "manual")` ET `statut` valide (envoye, envoye_manuel).

## Types TypeScript

Dans `frontend/src/types/email.ts` :

```typescript
export type EmailMode = "smtp" | "manual";

export interface ManualPrep {
  id: string;
  zip_filename: string;
  zip_path: string;
  taille_mo: number;
  contenu_tree: string[];
  objet: string;
  corps_plain: string;
  destinataires: string[];
  prepared_at: string;
  sent: boolean;
}

export interface ManualPrepRequest {
  documents: DocumentRef[];
  destinataires: string[];
  objet?: string;
  corps?: string;
}

// Étendre EmailHistoryEntry existant
export interface EmailHistoryEntry {
  // ... champs existants ...
  mode?: EmailMode;  // optionnel pour rétrocompat
}
```

## Hooks TanStack Query

Dans `frontend/src/hooks/useEmail.ts` (étendre l'existant) :

```typescript
export function useManualZips() {
  return useQuery({
    queryKey: ['email', 'manual-zips'],
    queryFn: () => api.get<ManualPrep[]>('/email/manual-zips'),
  });
}

export function usePrepareManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ManualPrepRequest) =>
      api.post<ManualPrep>('/email/prepare-manual', req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email', 'manual-zips'] });
    },
  });
}

export function useOpenManualInFinder() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/email/manual-zips/${id}/open-native`),
  });
}

export function useMarkManualSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/email/manual-zips/${id}/mark-sent`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email', 'manual-zips'] });
      qc.invalidateQueries({ queryKey: ['email', 'history'] });
      qc.invalidateQueries({ queryKey: ['email', 'coverage'] });
    },
  });
}

export function useDeleteManualZip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/email/manual-zips/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email', 'manual-zips'] });
    },
  });
}
```

## Composants frontend

### `ManualSendButton.tsx` (nouveau)

À placer dans le drawer, sous le bouton SMTP existant.

Props : `{ documents, destinataires, objet, corps, disabled }`.

Au clic :
1. Validation : au moins 1 document + au moins 1 destinataire (sinon toast.error)
2. Appel `prepareManual.mutate({ documents, destinataires, objet, corps })`
3. Sur succès :
   ```typescript
   await navigator.clipboard.writeText(result.corps_plain);
   await openInFinder.mutateAsync(result.id);
   const subject = encodeURIComponent(result.objet);
   const dest = result.destinataires.join(',');
   window.location.href = `mailto:${dest}?subject=${subject}`;
   toast.success(
     <div>
       <div>✓ ZIP ouvert dans Finder</div>
       <div>✓ Corps du mail copié</div>
       <div className="text-xs opacity-80 mt-1">Colle-le dans le brouillon (⌘V)</div>
     </div>,
     { duration: 6000 }
   );
   ```

Style : bouton secondaire (bg-surface-2 hover:bg-surface-3), icône `FolderDown` Lucide, pleine largeur.

Séparateur visuel au-dessus : `<div className="border-t border-border my-4 pt-4"><div className="text-xs text-text-muted mb-2">Si l'envoi automatique échoue :</div></div>`

### `ManualZipCard.tsx` (nouveau)

Carte dans la liste "ZIPs préparés".

Props : `{ zip: ManualPrep }`.

Layout :
```
┌──────────────────────────────────────────────┐
│ 📦 Documents_Comptables_2026-03.zip          │
│    12,4 Mo · préparé il y a 2h               │
│                                                │
│  [📂 Finder] [📋 Recopier] [✓ Envoyé] [🗑]    │
└──────────────────────────────────────────────┘
```

Actions :
- **Finder** : `openInFinder.mutate(zip.id)`
- **Recopier** : `navigator.clipboard.writeText(zip.corps_plain)` + re-ouverture `mailto:` + toast
- **Envoyé** : confirm → `markSent.mutate(zip.id)` + toast succès
- **🗑** : confirm via `showDeleteConfirmToast` (helper existant) → `deleteZip.mutate(zip.id)`

Date relative : utiliser `date-fns/formatDistanceToNow` avec locale `fr` (déjà installé dans le projet, vérifier).

### Section repliable dans le drawer

```tsx
const { data: manualZips = [] } = useManualZips();

{manualZips.length > 0 && (
  <CollapsibleSection
    title={`ZIPs préparés (${manualZips.length})`}
    defaultOpen={false}
  >
    <div className="space-y-2">
      {manualZips.map(zip => (
        <ManualZipCard key={zip.id} zip={zip} />
      ))}
    </div>
  </CollapsibleSection>
)}
```

Si `CollapsibleSection` n'existe pas, utiliser un pattern `<details>` + `<summary>` stylisé ou créer un mini composant inline.

## Paramètres > Stockage

Ajouter une ligne dans la grille des métriques :

```
ZIPs préparés en attente : N (X,X Mo)
[Vider les ZIPs préparés]
```

Bouton confirm → `POST /api/email/manual-zips/cleanup?max_age_days=0` (force tout supprimer).

## APScheduler

Dans le scheduler existant (probablement `task_service.py` ou un fichier dédié), ajouter une tâche quotidienne :

```python
scheduler.add_job(
    func=cleanup_old_manual_zips,
    trigger='cron',
    hour=3,
    minute=0,
    id='cleanup_manual_zips',
    replace_existing=True,
)
```

Logger le nombre supprimé.

## Ordre d'implémentation

1. **Backend models + service** (`prepare_manual_zip`, `_index.json` lifecycle, `mark_sent`, `delete`, `cleanup`)
2. **Backend endpoints** (router email.py)
3. **Mise à jour `coverage`** pour inclure `mode: "manual"`
4. **Tâche APScheduler** cleanup quotidien
5. **Types TS + hooks**
6. **`ManualSendButton.tsx`** + intégration dans le drawer
7. **`ManualZipCard.tsx`** + section repliable
8. **Paramètres > Stockage** : compteur + bouton vider
9. **Tests manuels** (checklist ci-dessous)

## Checklist de vérification

- [ ] Préparer ZIP avec 5 docs → fichier physique présent dans `data/exports/manual/`
- [ ] Entrée correspondante dans `_index.json`
- [ ] Finder s'ouvre sur le ZIP (macOS)
- [ ] Corps du mail bien dans le presse-papier (test ⌘V dans un éditeur)
- [ ] `mailto:` ouvre Mail.app ou Gmail web (selon défaut système) avec destinataires + objet
- [ ] La carte apparaît dans "ZIPs préparés" du drawer
- [ ] Click "Recopier" : clipboard + mailto à nouveau
- [ ] Click "Marquer envoyé" : carte disparaît, entrée dans email_history.json avec `mode: "manual"`
- [ ] `GET /coverage/{year}` reflète l'envoi manuel
- [ ] Click 🗑 : confirm + suppression ZIP physique + entrée index
- [ ] Cleanup manuel via Paramètres : tous les ZIPs supprimés
- [ ] APScheduler : simuler en lançant la fonction directement, vérifier suppression > 30j
- [ ] Bouton désactivé si aucun document sélectionné ou aucun destinataire
- [ ] Préparer manuel fonctionne **même si SMTP non configuré** (indépendance totale)
- [ ] Toast multi-ligne s'affiche correctement
- [ ] Date relative en français ("il y a 2 heures")
- [ ] Pas de TypeScript `any`
- [ ] Pas de régression sur l'envoi SMTP existant

## Anti-patterns à éviter

- ❌ Mélanger la logique manuelle dans `send_email()` : tout doit passer par `prepare_manual_zip()` séparé
- ❌ Réutiliser le ZIP créé par `send_email()` (qui est temporaire et supprimé) : le mode manuel a son propre dossier persistant
- ❌ Mettre le corps dans `mailto:?body=...` : limite ~2000 chars + encodage capricieux dans Gmail web. **Toujours** passer par le clipboard
- ❌ `useRef` ou `useEffect` pour déclencher le mailto : utiliser `window.location.href` directement dans le `onSuccess` de la mutation

## Notes

- Le mode manuel ne nécessite **pas** d'app password Gmail configuré
- Aucune modification du template HTML email (réutilisation de `generate_email_body_plain()`)
- L'ID du ZIP est généré côté backend via `secrets.token_urlsafe(8)` pour rester court et URL-safe
- Le nom du fichier ZIP inclut le timestamp pour éviter toute collision : `Documents_Comptables_{periode}_{YYYY-MM-DD_HH-MM}.zip`
- Si `data/exports/manual/` n'existe pas, le créer au boot dans le lifespan
