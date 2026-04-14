# Prompt Claude Code — Historique Envois Comptable

## Contexte

Ajouter un historique des envois email au comptable. Chaque envoi via `POST /api/email/send` est loggé dans `data/email_history.json`. L'historique est consultable dans le drawer d'envoi comptable via un onglet dédié.

Lire `CLAUDE.md` en premier.

---

## Ordre d'implémentation

1. Model Pydantic
2. Service (log + lecture)
3. Router (endpoint lecture)
4. Intégration dans `email_service.send_email()`
5. Type TypeScript
6. Hook
7. Onglet historique dans SendToAccountantDrawer

---

## 1. Backend — Model

### `backend/models/email.py` (ajouter au fichier existant)

```python
class EmailHistoryEntry(BaseModel):
    """Entrée d'historique d'envoi."""
    id: str                          # UUID court (8 chars)
    sent_at: str                     # ISO datetime
    destinataires: list[str]
    objet: str
    documents: list[DocumentRef]     # DocumentRef existe déjà
    nb_documents: int
    taille_totale_mo: float
    success: bool
    error_message: Optional[str] = None
```

---

## 2. Backend — Service

### `backend/services/email_history_service.py` (nouveau fichier)

Fichier de stockage : `data/email_history.json` — tableau JSON en append-only.

**Fonctions :**

### `log_send(entry: EmailHistoryEntry) -> None`
- Charger le fichier existant (ou `[]` si inexistant)
- Append l'entrée
- Sauvegarder (écriture atomique via fichier temporaire + rename)

### `get_history(year: Optional[int] = None, limit: int = 50) -> list[EmailHistoryEntry]`
- Charger le fichier
- Filtrer par année si fournie (parser `sent_at`)
- Trier par `sent_at` décroissant
- Limiter à `limit` entrées
- Retourner la liste

### `get_send_coverage(year: int) -> dict[int, bool]`
- Pour une année donnée, retourner un dict `{mois: True/False}` indiquant si au moins un envoi contenant un export de ce mois existe
- Utile pour croiser avec la clôture (quels mois ont été transmis)

---

## 3. Backend — Router

### `backend/routers/email.py` (ajouter aux endpoints existants)

### `GET /history` → `list[EmailHistoryEntry]`
- Query params : `year` (Optional[int]), `limit` (int, default 50)
- Appelle `email_history_service.get_history()`

### `GET /coverage/{year}` → `dict[int, bool]`
- Appelle `email_history_service.get_send_coverage(year)`

---

## 4. Backend — Intégration dans send_email

### `backend/services/email_service.py`

Dans la fonction `send_email()`, **après** l'envoi (succès ou échec), logger l'entrée :

```python
import uuid
from datetime import datetime
from backend.services import email_history_service
from backend.models.email import EmailHistoryEntry

# Après le try/except d'envoi SMTP :
entry = EmailHistoryEntry(
    id=uuid.uuid4().hex[:8],
    sent_at=datetime.now().isoformat(),
    destinataires=destinataires,
    objet=objet,
    documents=documents,
    nb_documents=len(documents),
    taille_totale_mo=taille_mo,
    success=result.success,
    error_message=None if result.success else result.message,
)
email_history_service.log_send(entry)
```

Logger aussi bien les succès que les échecs (utile pour diagnostiquer).

---

## 5. Frontend — Type

### `frontend/src/types/index.ts` (ajouter)

```typescript
export interface EmailHistoryEntry {
  id: string;
  sent_at: string;
  destinataires: string[];
  objet: string;
  documents: DocumentRef[];
  nb_documents: number;
  taille_totale_mo: number;
  success: boolean;
  error_message?: string;
}
```

---

## 6. Frontend — Hook

### `frontend/src/hooks/useEmail.ts` (ajouter au fichier existant)

```typescript
export function useEmailHistory(year?: number) {
  return useQuery<EmailHistoryEntry[]>({
    queryKey: ['email-history', year],
    queryFn: () => {
      const params = new URLSearchParams();
      if (year) params.set('year', String(year));
      return api.get(`/api/email/history?${params}`);
    },
  });
}
```

---

## 7. Frontend — Onglet historique

### Modification de `SendToAccountantDrawer.tsx`

Ajouter 2 onglets dans le header du drawer : **"Nouveau"** (contenu actuel) et **"Historique"**.

**Onglet Historique (pleine largeur, pas de split) :**

Liste des envois passés, chaque entrée est une carte :

```
┌─────────────────────────────────────────────────────┐
│ ● 15/03/2025 à 14:32          cabinet.martin@...    │
│ Export comptable — Mars 2025                        │
│ 3 documents · 5.5 Mo                               │
│ ✓ Envoyé avec succès                               │
└─────────────────────────────────────────────────────┘
```

- Pastille verte si `success`, rouge sinon
- Date formatée en FR (`DD/MM/YYYY à HH:MM`)
- Destinataires en chips muted (tronqués si > 2, afficher `+N`)
- Objet en font-weight 500
- Ligne détail : `{nb_documents} documents · {taille} Mo`
- Statut : "Envoyé avec succès" en vert, ou `error_message` en rouge
- Au hover/clic sur une entrée : expansion avec la liste des documents envoyés (nom + type badge)

Style cartes : `bg-surface rounded-lg p-4 border border-border`, gap `8px` entre les cartes.

Si historique vide : message centré "Aucun envoi pour le moment" avec icône `Mail` muted.

**Onglets :**
- Style : 2 boutons texte en haut du drawer, sous le header
- Actif : `text-text font-medium border-b-2 border-primary`
- Inactif : `text-text-muted`
- Le switch onglet ne ferme/réouvre pas le drawer

---

## Vérification

- [ ] `EmailHistoryEntry` ajouté dans `backend/models/email.py`
- [ ] `backend/services/email_history_service.py` créé avec `log_send`, `get_history`, `get_send_coverage`
- [ ] Endpoints `GET /history` et `GET /coverage/{year}` ajoutés au router email
- [ ] `send_email()` logge chaque envoi (succès + échec) dans l'historique
- [ ] `data/email_history.json` créé automatiquement au premier envoi
- [ ] Type `EmailHistoryEntry` ajouté dans `types/index.ts`
- [ ] Hook `useEmailHistory` ajouté dans `useEmail.ts`
- [ ] Onglets "Nouveau" / "Historique" dans le drawer
- [ ] Cartes historique avec expansion documents au clic
- [ ] `from __future__ import annotations` dans les nouveaux fichiers Python
- [ ] Pas de `any` TypeScript
