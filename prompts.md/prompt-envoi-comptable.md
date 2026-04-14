# Prompt Claude Code — Envoi Comptable (Drawer universel)

## Contexte

Ajouter un drawer universel d'envoi de documents au comptable par email (SMTP Gmail). Le drawer permet de sélectionner des documents de toutes sources (exports, rapports, relevés, justificatifs, documents GED), composer le mail, et envoyer. Accessible depuis 3 points d'entrée : sidebar, page Exports, page GED.

**Pré-requis déjà implémentés** : les champs email (`email_smtp_user`, `email_smtp_app_password`, `email_comptable_destinataires`, `email_default_nom`) existent déjà dans le modèle Settings et la page Paramètres. Ne pas les recréer.

Lire `CLAUDE.md` en premier.

---

## Ordre d'implémentation

1. Models Pydantic (email)
2. Email service (nouveau)
3. Email router (nouveau)
4. Registration dans `main.py`
5. Types TypeScript
6. Store Zustand (SendDrawerStore)
7. Hooks email
8. Composant EmailChipsInput (réutilisable)
9. Composant SendToAccountantDrawer (drawer universel)
10. Intégration sidebar
11. Intégration ExportPage
12. Intégration GedPage

---

## 1. Backend — Models

### `backend/models/email.py` (nouveau fichier)

```python
from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class DocumentRef(BaseModel):
    """Référence à un document à joindre."""
    type: str        # "export" | "rapport" | "releve" | "justificatif" | "ged"
    filename: str    # Nom du fichier


class EmailSendRequest(BaseModel):
    """Requête d'envoi d'email avec documents."""
    documents: list[DocumentRef]
    destinataires: list[str]
    objet: Optional[str] = None
    corps: Optional[str] = None


class EmailSendResponse(BaseModel):
    """Réponse après envoi."""
    success: bool
    message: str
    destinataires: list[str]
    fichiers_envoyes: list[str]
    taille_totale_mo: float


class EmailTestResponse(BaseModel):
    """Réponse test connexion SMTP."""
    success: bool
    message: str


class DocumentInfo(BaseModel):
    """Document disponible pour envoi."""
    type: str           # "export" | "rapport" | "releve" | "justificatif" | "ged"
    filename: str
    display_name: str   # Nom affiché dans la liste
    size_bytes: int
    date: Optional[str] = None       # ISO date si disponible
    category: Optional[str] = None   # Pour grouper dans l'affichage
```

---

## 2. Backend — Email Service

### `backend/services/email_service.py` (nouveau fichier)

**Imports nécessaires :**
```python
from __future__ import annotations

import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from typing import Optional

from backend.core.config import EXPORTS_DIR, REPORTS_DIR, RELEVES_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR, GED_DIR
from backend.models.email import DocumentRef, DocumentInfo, EmailSendResponse, EmailTestResponse

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
MAX_TOTAL_SIZE_MB = 25
```

**Fonctions à implémenter :**

### `_resolve_document_path(doc: DocumentRef) -> Optional[Path]`
Résout le chemin physique d'un document selon son type :
- `"export"` → chercher dans `EXPORTS_DIR`
- `"rapport"` → chercher dans `REPORTS_DIR`
- `"releve"` → chercher dans `RELEVES_DIR`
- `"justificatif"` → chercher dans `JUSTIFICATIFS_TRAITES_DIR` puis `JUSTIFICATIFS_EN_ATTENTE_DIR`
- `"ged"` → chercher dans `GED_DIR` récursivement (sous-dossiers `{year}/{month}/`)

Retourne `None` si le fichier n'est pas trouvé.

### `test_smtp_connection(smtp_user: str, smtp_password: str) -> EmailTestResponse`
Test SMTP sans envoi :
- `smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)`
- `ehlo()` → `starttls()` → `ehlo()` → `login()`
- Catch `SMTPAuthenticationError` → message spécifique "vérifiez le mot de passe d'application"
- Catch `Exception` → message générique

### `list_available_documents(doc_type: Optional[str], year: Optional[int], month: Optional[int]) -> list[DocumentInfo]`
Liste les documents disponibles pour envoi :
- Pour chaque type, scanner le répertoire correspondant
- Extraire `display_name` (nettoyer le préfixe horodaté des justificatifs), `size_bytes`, `date` (depuis le nom de fichier si possible)
- Filtrer par `year` et `month` si fournis (parser depuis le nom de fichier : `2025-03`, `_202503_`, etc.)
- Filtrer par `doc_type` si fourni
- Trier par date décroissante
- Exclure les fichiers non-documents (`.ocr.json`, `.png` thumbnails, etc.)

### `send_email(smtp_user, smtp_password, nom_expediteur, destinataires, objet, corps, documents: list[DocumentRef]) -> EmailSendResponse`
Envoi email avec pièces jointes :
1. Résoudre tous les chemins via `_resolve_document_path()` → erreur si un fichier manque
2. Calculer la taille totale → erreur si > `MAX_TOTAL_SIZE_MB`
3. Construire `MIMEMultipart` :
   - `From` : `"{nom_expediteur} <{smtp_user}>"` si nom fourni, sinon `smtp_user`
   - `To` : `", ".join(destinataires)`
   - `Subject` : objet
   - Body : `MIMEText(corps, "plain", "utf-8")`
   - Pour chaque document : `MIMEBase("application", "octet-stream")` + `encode_base64` + header `Content-Disposition` avec filename
4. Envoyer via `smtplib.SMTP` + STARTTLS + login
5. Logger le succès
6. Catch `SMTPAuthenticationError` et `Exception`

### `generate_email_subject(documents: list[DocumentRef], nom: Optional[str]) -> str`
Génère un objet automatique :
- Si uniquement des exports → parser les mois depuis les noms de fichiers (`Export_Comptable_2025-03_Mars.zip` → "Mars")
- Si mix de types → "Documents comptables — {périodes} — {nom}"
- Si un seul document → nom du fichier simplifié

### `generate_email_body(documents: list[DocumentRef], nom: Optional[str]) -> str`
Génère le corps automatique :
- Salutation
- Phrase d'introduction avec le nombre de documents
- Liste groupée par type : "- {n} exports comptables (mois1, mois2)", "- {n} rapports", etc.
- Signature avec `nom` ou "Dr"

---

## 3. Backend — Email Router

### `backend/routers/email.py` (nouveau fichier)

Préfixe : `/api/email`, tag : `email`

### `POST /test-connection` → `EmailTestResponse`
- Charge les settings via `settings_service.load_settings()`
- Vérifie que `email_smtp_user` et `email_smtp_app_password` sont renseignés → 400 sinon
- Appelle `email_service.test_smtp_connection()`

### `GET /documents` → `list[DocumentInfo]`
- Query params : `type` (Optional[str]), `year` (Optional[int]), `month` (Optional[int])
- Appelle `email_service.list_available_documents()`

### `POST /preview` → `dict`
- Body : `list[str]` (filenames) — ou mieux un modèle `EmailPreviewRequest` avec `documents: list[DocumentRef]`
- Charge les settings pour `nom` et `destinataires`
- Retourne `{ destinataires, objet, corps }` pré-générés

### `POST /send` → `EmailSendResponse`
- Body : `EmailSendRequest`
- Charge les settings pour credentials
- Vérifie credentials → 400 sinon
- Génère objet/corps si non fournis via `generate_email_subject/body`
- Appelle `email_service.send_email()`

---

## 4. Backend — Registration

### `backend/main.py`

Ajouter :
```python
from backend.routers import email as email_router
# Dans la section des include_router :
app.include_router(email_router.router)
```

**Note** : vérifier que les constantes `RELEVES_DIR` (`data/imports/releves`), `JUSTIFICATIFS_EN_ATTENTE_DIR`, `JUSTIFICATIFS_TRAITES_DIR` existent dans `backend/core/config.py`. Si elles n'existent pas sous ces noms exacts, les créer en dérivant de `DATA_DIR`. Ne pas casser les imports existants.

---

## 5. Frontend — Types

### `frontend/src/types/index.ts`

Ajouter :

```typescript
// === Email / Envoi Comptable ===

export interface DocumentRef {
  type: 'export' | 'rapport' | 'releve' | 'justificatif' | 'ged';
  filename: string;
}

export interface DocumentInfo {
  type: 'export' | 'rapport' | 'releve' | 'justificatif' | 'ged';
  filename: string;
  display_name: string;
  size_bytes: number;
  date?: string;
  category?: string;
}

export interface EmailSendRequest {
  documents: DocumentRef[];
  destinataires: string[];
  objet?: string;
  corps?: string;
}

export interface EmailSendResponse {
  success: boolean;
  message: string;
  destinataires: string[];
  fichiers_envoyes: string[];
  taille_totale_mo: number;
}

export interface EmailTestResponse {
  success: boolean;
  message: string;
}

export interface EmailPreview {
  destinataires: string[];
  objet: string;
  corps: string;
}
```

---

## 6. Frontend — Store Zustand

### `frontend/src/stores/sendDrawerStore.ts` (nouveau fichier)

```typescript
import { create } from 'zustand';
import type { DocumentRef } from '../types';

interface SendDrawerState {
  isOpen: boolean;
  preselected: DocumentRef[];
  defaultFilter?: string;  // type pré-filtré à l'ouverture
  open: (opts?: { preselected?: DocumentRef[]; defaultFilter?: string }) => void;
  close: () => void;
}

export const useSendDrawerStore = create<SendDrawerState>((set) => ({
  isOpen: false,
  preselected: [],
  defaultFilter: undefined,
  open: (opts) => set({
    isOpen: true,
    preselected: opts?.preselected ?? [],
    defaultFilter: opts?.defaultFilter,
  }),
  close: () => set({
    isOpen: false,
    preselected: [],
    defaultFilter: undefined,
  }),
}));
```

---

## 7. Frontend — Hooks

### `frontend/src/hooks/useEmail.ts` (nouveau fichier)

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../api/client';
import type {
  DocumentInfo,
  DocumentRef,
  EmailSendRequest,
  EmailSendResponse,
  EmailTestResponse,
  EmailPreview,
} from '../types';

export function useAvailableDocuments(type?: string, year?: number, month?: number) {
  return useQuery<DocumentInfo[]>({
    queryKey: ['email-documents', type, year, month],
    queryFn: () => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (year) params.set('year', String(year));
      if (month) params.set('month', String(month));
      return api.get(`/api/email/documents?${params}`);
    },
  });
}

export function useTestEmailConnection() {
  return useMutation<EmailTestResponse>({
    mutationFn: () => api.post('/api/email/test-connection'),
  });
}

export function useEmailPreview() {
  return useMutation<EmailPreview, Error, DocumentRef[]>({
    mutationFn: (documents) => api.post('/api/email/preview', { documents }),
  });
}

export function useSendEmail() {
  return useMutation<EmailSendResponse, Error, EmailSendRequest>({
    mutationFn: (data) => api.post('/api/email/send', data),
  });
}
```

---

## 8. Frontend — EmailChipsInput

### `frontend/src/components/common/EmailChipsInput.tsx` (nouveau fichier)

Composant réutilisable pour saisie d'emails en chips.

**Props :**
```typescript
interface EmailChipsInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
}
```

**Comportement :**
- Affiche chaque email en chip : fond `bg-blue-500/10`, texte `text-blue-400`, `rounded-full`, `px-3 py-1`, `text-sm`
- Bouton `×` sur chaque chip pour supprimer
- Input texte en fin de liste, même ligne (flex-wrap)
- Validation email basique au `Enter` (regex simple : contient `@` et `.`)
- `Backspace` sur input vide → supprime le dernier chip
- Pas de doublon (ignorer si email déjà présent)
- Border container : `border border-border rounded-lg p-2 flex flex-wrap gap-1.5 items-center min-h-[38px]`

**Note** : ce composant est réutilisé dans `SendToAccountantDrawer` et potentiellement dans la page Paramètres (vérifier si la section email existante utilise un pattern similaire — si oui, refactorer pour utiliser `EmailChipsInput`).

---

## 9. Frontend — SendToAccountantDrawer

### `frontend/src/components/email/SendToAccountantDrawer.tsx` (nouveau fichier)

Drawer plein écran en 2 colonnes. Composant central de la feature.

**Ouverture/fermeture :**
- Piloté par `useSendDrawerStore`
- Overlay backdrop semi-transparent (clic → ferme)
- Touche `Escape` → ferme
- Animation `translateX(100%)` → `translateX(0)` (pattern drawer existant)
- Largeur : `100vw` max `1100px`, depuis la droite

**Colonne gauche — Sélection des documents (~55% largeur) :**

Header filtres :
- **Chips toggleables** par type de document : Exports, Rapports, Relevés, Justificatifs, Documents GED
  - Chips actifs : `bg-blue-500/10 text-blue-400 font-medium`
  - Chips inactifs : `border border-border text-text-muted`
  - Multi-sélection (toggle on/off, tous actifs par défaut)
  - Si `defaultFilter` fourni par le store → seul ce type est actif à l'ouverture
- **Sélecteur période** : 2 selects (année + plage)
  - Année : liste des années disponibles
  - Plage : "Toute l'année", "T1 (Jan-Mar)", "T2 (Avr-Jun)", "T3 (Jul-Sep)", "T4 (Oct-Déc)", et les 12 mois individuels
- **Bouton raccourci** "Tout le trimestre" / "Tout le mois" → coche tous les documents de la période sélectionnée

Liste des documents :
- Chargée via `useAvailableDocuments()` — recharger quand les filtres changent
- Groupée par type avec header collapsible (icône + nom du type + compteur + checkbox "tout" par groupe)
- Icônes par type : `Archive` (exports), `FileText` (rapports), `FileSpreadsheet` (relevés), `Paperclip` (justificatifs), `FolderOpen` (GED)
- Chaque ligne : checkbox 16px + nom fichier + taille (Mo, arrondi 1 décimale) + bordure bottom subtile
- Checkbox cochée : même style que les checkboxes modernes de l'app (carré arrondi, fond `primary`, icône `Check` blanc)
- Les documents `preselected` du store sont pré-cochés à l'ouverture

Footer colonne gauche :
- Compteur : `{n} documents sélectionnés`
- Taille totale : `{x.x} Mo`

**Colonne droite — Composition du mail (~45% largeur) :**

Séparée par un `border-l border-border`.

Header : "Composer le message" en texte muted.

Champs :
- **À** : `EmailChipsInput` pré-rempli avec les `email_comptable_destinataires` des settings (charger via `GET /api/settings`). Modifiable ponctuellement sans persister.
- **Objet** : input texte, pré-rempli via `useEmailPreview` (appelé quand la sélection change, debounce 500ms)
- **Message** : textarea 6 lignes, pré-rempli via `useEmailPreview`, auto-mis à jour quand la sélection change
- **Pièces jointes** : liste readonly des documents cochés avec icône type + nom tronqué (ellipsis) + taille individuelle. Scrollable si > 4 items (max-height ~140px).
- **Jauge taille** : barre de progression visuelle (largeur proportionnelle à `total / 25 Mo`)
  - Texte gauche : `Total : {x.x} Mo`
  - Barre : fond `bg-surface`, remplissage `bg-blue-500` (ou `bg-red-500` si > 25 Mo)
  - Texte droite : `25 Mo`

Footer colonne droite :
- Bouton "Annuler" (style default)
- Bouton "Envoyer ({n} docs)" (style primaire, icône `Send`)
  - Désactivé si : aucun document sélectionné, aucun destinataire, taille > 25 Mo
  - Au clic → appelle `useSendEmail`
  - Loading state : spinner + texte "Envoi en cours..."
  - Succès → `toast.success("Email envoyé avec succès à {n} destinataire(s)")` + ferme le drawer
  - Erreur → `toast.error(response.message)`

---

## 10. Intégration — Montage global

### `frontend/src/App.tsx`

Monter `<SendToAccountantDrawer />` au niveau racine, en dehors du `<Routes>`, à côté des autres éléments globaux (Toaster, etc.) :

```tsx
<SendToAccountantDrawer />
```

Le composant lit `useSendDrawerStore().isOpen` pour s'afficher/masquer.

---

## 11. Intégration — Sidebar

### Modification du composant Sidebar existant

Ajouter un item **"Envoi comptable"** en bas de la sidebar, hors des groupes existants (après le groupe OUTILS), avec un style distinct (séparateur + icône `Send` Lucide).

```tsx
import { useSendDrawerStore } from '../stores/sendDrawerStore';

// Dans le render, après le dernier groupe :
<div className="border-t border-border mt-2 pt-2">
  <button
    onClick={() => useSendDrawerStore.getState().open()}
    className="flex items-center gap-3 px-4 py-2.5 w-full text-left text-sm text-text-muted hover:bg-surface hover:text-text rounded-lg transition-colors"
  >
    <Send size={18} />
    <span>Envoi comptable</span>
  </button>
</div>
```

Pas de navigation (pas de `<NavLink>`), c'est un bouton qui ouvre le drawer.

---

## 12. Intégration — ExportPage

### Modification de `frontend/src/components/ExportPage.tsx`

**A. Ajouter la sélection multi-export :**

- State : `const [selectedExports, setSelectedExports] = useState<Set<string>>(new Set())`
- Chaque carte export ZIP reçoit une checkbox toggle (pattern checkboxes modernes : bouton 22px carré arrondi, `Check` icon blanc si coché, border `border-border` si décoché)
- Toolbar conditionnelle (visible quand `selectedExports.size > 0`) dans le `PageHeader` ou en barre fixe sous le header :
  - Checkbox "tout sélectionner" avec état intermédiaire (`Minus` si partiel, `Check` si tout)
  - Compteur : `{n} sélectionné(s)`
  - Bouton "Télécharger ({n})" icône `Download`
  - Bouton primaire "Envoyer au comptable ({n})" icône `Send`
- Les cartes sélectionnées ont `ring-2 ring-primary` au lieu de la border par défaut

**B. Bouton "Envoyer au comptable" :**

Ouvre le drawer avec les exports sélectionnés pré-cochés :

```tsx
import { useSendDrawerStore } from '../stores/sendDrawerStore';

const handleSendToAccountant = () => {
  const preselected = Array.from(selectedExports).map(filename => ({
    type: 'export' as const,
    filename,
  }));
  useSendDrawerStore.getState().open({ preselected, defaultFilter: 'export' });
};
```

**C. Bouton permanent dans PageHeader actions :**

En plus du bouton contextuel de la toolbar, ajouter un bouton `Send` dans les `actions` du `PageHeader` qui ouvre le drawer avec `defaultFilter: 'export'` mais sans pré-sélection (pour envoyer n'importe quel export).

---

## 13. Intégration — GedPage

### Modification de `frontend/src/components/ged/GedPage.tsx`

Ajouter un bouton dans les `actions` du `PageHeader` :

```tsx
import { useSendDrawerStore } from '../../stores/sendDrawerStore';

// Dans les actions du PageHeader :
<button
  onClick={() => {
    // Mapper la vue GED courante vers le type de document
    const filterMap: Record<string, string> = {
      'rapport': 'rapport',
      'justificatif': 'justificatif',
      'releve': 'releve',
      'document_libre': 'ged',
    };
    const defaultFilter = filterMap[currentTypeFilter] || undefined;
    useSendDrawerStore.getState().open({ defaultFilter });
  }}
  className="..."
>
  <Send size={16} />
  Envoyer au comptable
</button>
```

Le `currentTypeFilter` vient du state existant de la page GED (filtre type actif). Si aucun filtre type actif, ouvre le drawer sans filtre par défaut.

---

## Vérification

### Backend
- [ ] `backend/models/email.py` créé avec `DocumentRef`, `EmailSendRequest`, `EmailSendResponse`, `EmailTestResponse`, `DocumentInfo`
- [ ] `backend/services/email_service.py` créé avec 6 fonctions (`_resolve_document_path`, `test_smtp_connection`, `list_available_documents`, `send_email`, `generate_email_subject`, `generate_email_body`)
- [ ] `backend/routers/email.py` créé avec 4 endpoints (`test-connection`, `documents`, `preview`, `send`)
- [ ] Router email inclus dans `main.py`
- [ ] Constantes répertoires vérifiées/ajoutées dans `config.py` si manquantes
- [ ] `from __future__ import annotations` dans tous les fichiers Python

### Frontend
- [ ] Types ajoutés dans `types/index.ts` (6 interfaces)
- [ ] `stores/sendDrawerStore.ts` créé
- [ ] `hooks/useEmail.ts` créé avec 4 hooks
- [ ] `components/common/EmailChipsInput.tsx` créé et réutilisable
- [ ] `components/email/SendToAccountantDrawer.tsx` créé — drawer 2 colonnes complet
- [ ] `SendToAccountantDrawer` monté dans `App.tsx`
- [ ] Sidebar : bouton "Envoi comptable" ajouté en bas (hors groupes)
- [ ] ExportPage : checkboxes sélection + toolbar conditionnelle + bouton PageHeader
- [ ] GedPage : bouton "Envoyer au comptable" dans PageHeader avec filtre contextuel
- [ ] Pas de `any` TypeScript
- [ ] Dark theme respecté (CSS variables, classes Tailwind dark)
- [ ] Bouton "Envoyer" désactivé si taille > 25 Mo ou aucun document ou aucun destinataire
- [ ] Toast succès/erreur après envoi via `react-hot-toast`
- [ ] Preview email (objet + corps) auto-mis à jour quand la sélection change (debounce 500ms)
