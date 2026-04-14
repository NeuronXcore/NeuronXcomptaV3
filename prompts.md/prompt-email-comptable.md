# Prompt Claude Code — Envoi Email Comptable

## Contexte

Ajouter la fonctionnalité d'envoi d'exports comptables par email au comptable, directement depuis l'application via SMTP Gmail. L'utilisateur configure son compte Gmail + app password + liste de destinataires dans les Paramètres. Depuis la page Exports, il sélectionne un ou plusieurs ZIPs et les envoie via une modale de confirmation.

Lire `CLAUDE.md` en premier.

---

## Ordre d'implémentation

1. Models (Pydantic)
2. Settings service (ajout champs email)
3. Email service (nouveau)
4. Email router (nouveau)
5. Registration dans `main.py`
6. Types TypeScript
7. Hooks
8. Composant Settings (section email)
9. Composant ExportPage (sélection + modale envoi)

---

## 1. Backend — Models

### `backend/models/settings.py`

Ajouter les champs email au modèle Settings existant :

```python
# Ajouter à la classe Settings existante :
email_smtp_user: Optional[str] = None          # Gmail expéditeur
email_smtp_app_password: Optional[str] = None   # Mot de passe d'application Google
email_comptable_destinataires: list[str] = []   # Liste emails destinataires
email_default_nom: Optional[str] = None         # Nom expéditeur (ex: "Dr Dupont")
```

### `backend/models/email.py` (nouveau fichier)

```python
from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class EmailSendRequest(BaseModel):
    """Requête d'envoi d'email avec exports."""
    filenames: list[str]                         # Noms des ZIPs à envoyer
    destinataires: list[str]                     # Emails destinataires (override possible)
    objet: Optional[str] = None                  # Objet custom (sinon auto-généré)
    corps: Optional[str] = None                  # Corps custom (sinon auto-généré)


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
```

---

## 2. Backend — Email Service

### `backend/services/email_service.py` (nouveau fichier)

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

from backend.core.config import EXPORTS_DIR, MOIS_FR
from backend.models.email import EmailSendResponse, EmailTestResponse

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
MAX_ATTACHMENT_SIZE_MB = 25  # Limite Gmail


def test_smtp_connection(smtp_user: str, smtp_password: str) -> EmailTestResponse:
    """Test la connexion SMTP sans envoyer de mail."""
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_password)
        return EmailTestResponse(success=True, message="Connexion SMTP Gmail réussie")
    except smtplib.SMTPAuthenticationError:
        return EmailTestResponse(success=False, message="Échec authentification — vérifiez le mot de passe d'application")
    except Exception as e:
        return EmailTestResponse(success=False, message=f"Erreur connexion : {str(e)}")


def send_exports_email(
    smtp_user: str,
    smtp_password: str,
    nom_expediteur: Optional[str],
    destinataires: list[str],
    objet: str,
    corps: str,
    filenames: list[str],
) -> EmailSendResponse:
    """Envoie un email avec les exports ZIP en pièces jointes."""
    # Vérifier les fichiers
    fichiers: list[Path] = []
    taille_totale = 0
    for fname in filenames:
        fpath = EXPORTS_DIR / fname
        if not fpath.exists():
            return EmailSendResponse(
                success=False,
                message=f"Fichier introuvable : {fname}",
                destinataires=destinataires,
                fichiers_envoyes=[],
                taille_totale_mo=0,
            )
        taille_totale += fpath.stat().st_size
        fichiers.append(fpath)

    taille_mo = round(taille_totale / (1024 * 1024), 2)
    if taille_mo > MAX_ATTACHMENT_SIZE_MB:
        return EmailSendResponse(
            success=False,
            message=f"Taille totale {taille_mo} Mo dépasse la limite Gmail de {MAX_ATTACHMENT_SIZE_MB} Mo",
            destinataires=destinataires,
            fichiers_envoyes=[],
            taille_totale_mo=taille_mo,
        )

    # Construire le mail
    msg = MIMEMultipart()
    from_display = f"{nom_expediteur} <{smtp_user}>" if nom_expediteur else smtp_user
    msg["From"] = from_display
    msg["To"] = ", ".join(destinataires)
    msg["Subject"] = objet
    msg.attach(MIMEText(corps, "plain", "utf-8"))

    # Pièces jointes
    for fpath in fichiers:
        with open(fpath, "rb") as f:
            part = MIMEBase("application", "zip")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{fpath.name}"')
        msg.attach(part)

    # Envoi
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, destinataires, msg.as_string())

        logger.info(f"Email envoyé à {destinataires} avec {len(fichiers)} PJ ({taille_mo} Mo)")
        return EmailSendResponse(
            success=True,
            message=f"Email envoyé avec succès à {len(destinataires)} destinataire(s)",
            destinataires=destinataires,
            fichiers_envoyes=filenames,
            taille_totale_mo=taille_mo,
        )
    except smtplib.SMTPAuthenticationError:
        return EmailSendResponse(
            success=False,
            message="Échec authentification SMTP — vérifiez le mot de passe d'application",
            destinataires=destinataires,
            fichiers_envoyes=[],
            taille_totale_mo=taille_mo,
        )
    except Exception as e:
        logger.error(f"Erreur envoi email : {e}")
        return EmailSendResponse(
            success=False,
            message=f"Erreur envoi : {str(e)}",
            destinataires=destinataires,
            fichiers_envoyes=[],
            taille_totale_mo=taille_mo,
        )


def generate_email_subject(filenames: list[str], nom: Optional[str] = None) -> str:
    """Génère un objet d'email à partir des noms de fichiers export."""
    # Parse les mois depuis les noms de fichiers : Export_Comptable_2025-03_Mars.zip
    periodes = []
    for fname in filenames:
        parts = fname.replace("Export_Comptable_", "").replace(".zip", "").split("_")
        if len(parts) >= 2:
            periodes.append(parts[1])  # "Mars", "Février"...
        elif len(parts) == 1:
            periodes.append(parts[0])

    if len(periodes) == 1:
        label = f"Export comptable — {periodes[0]}"
    else:
        label = f"Exports comptables — {' & '.join(periodes)}"

    if nom:
        label += f" — {nom}"
    return label


def generate_email_body(
    filenames: list[str],
    nom: Optional[str] = None,
    recap: Optional[dict] = None,
) -> str:
    """Génère le corps de l'email avec récap optionnel."""
    periodes = []
    for fname in filenames:
        parts = fname.replace("Export_Comptable_", "").replace(".zip", "").split("_")
        if len(parts) >= 2:
            periodes.append(parts[1])

    if len(periodes) == 1:
        intro = f"Veuillez trouver ci-joint l'export comptable de {periodes[0]}."
    else:
        intro = f"Veuillez trouver ci-joints les exports comptables de {' et '.join(periodes)}."

    lines = ["Bonjour,", "", intro]

    if recap:
        lines.append("")
        lines.append("Récapitulatif :")
        if "nb_ops_pro" in recap:
            lines.append(f"• {recap['nb_ops_pro']} opérations professionnelles")
        if "total_recettes" in recap:
            lines.append(f"• Recettes : {recap['total_recettes']}")
        if "total_charges" in recap:
            lines.append(f"• Charges : {recap['total_charges']}")
        if "solde_bnc" in recap:
            lines.append(f"• Solde BNC : {recap['solde_bnc']}")

    signature = nom or "Dr"
    lines.extend(["", f"Cordialement,", signature])
    return "\n".join(lines)
```

---

## 3. Backend — Email Router

### `backend/routers/email.py` (nouveau fichier)

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from backend.models.email import EmailSendRequest, EmailSendResponse, EmailTestResponse
from backend.services import email_service, settings_service

router = APIRouter(prefix="/api/email", tags=["email"])


@router.post("/test-connection", response_model=EmailTestResponse)
async def test_connection():
    """Test la connexion SMTP avec les credentials settings."""
    settings = settings_service.load_settings()
    if not settings.get("email_smtp_user") or not settings.get("email_smtp_app_password"):
        raise HTTPException(status_code=400, detail="Email non configuré dans les paramètres")
    return email_service.test_smtp_connection(
        settings["email_smtp_user"],
        settings["email_smtp_app_password"],
    )


@router.post("/send-exports", response_model=EmailSendResponse)
async def send_exports(request: EmailSendRequest):
    """Envoie des exports comptables par email."""
    settings = settings_service.load_settings()
    smtp_user = settings.get("email_smtp_user")
    smtp_password = settings.get("email_smtp_app_password")
    if not smtp_user or not smtp_password:
        raise HTTPException(status_code=400, detail="Email non configuré dans les paramètres")

    # Générer objet/corps si non fournis
    nom = settings.get("email_default_nom")
    objet = request.objet or email_service.generate_email_subject(request.filenames, nom)
    corps = request.corps or email_service.generate_email_body(request.filenames, nom)

    return email_service.send_exports_email(
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        nom_expediteur=nom,
        destinataires=request.destinataires,
        objet=objet,
        corps=corps,
        filenames=request.filenames,
    )


@router.post("/preview", response_model=dict)
async def preview_email(filenames: list[str]):
    """Génère une prévisualisation du mail (objet + corps)."""
    settings = settings_service.load_settings()
    nom = settings.get("email_default_nom")
    destinataires = settings.get("email_comptable_destinataires", [])
    return {
        "destinataires": destinataires,
        "objet": email_service.generate_email_subject(filenames, nom),
        "corps": email_service.generate_email_body(filenames, nom),
    }
```

---

## 4. Backend — Registration

### `backend/main.py`

Ajouter l'import et l'inclusion du router :

```python
from backend.routers import email as email_router
# ...
app.include_router(email_router.router)
```

---

## 5. Frontend — Types

### `frontend/src/types/index.ts`

Ajouter :

```typescript
// === Email ===

export interface EmailSendRequest {
  filenames: string[];
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

## 6. Frontend — Hooks

### `frontend/src/hooks/useEmail.ts` (nouveau fichier)

```typescript
import { useMutation } from '@tanstack/react-query';
import api from '../api/client';
import type { EmailSendRequest, EmailSendResponse, EmailTestResponse, EmailPreview } from '../types';

export function useTestEmailConnection() {
  return useMutation<EmailTestResponse>({
    mutationFn: () => api.post('/api/email/test-connection'),
  });
}

export function useSendExportsEmail() {
  return useMutation<EmailSendResponse, Error, EmailSendRequest>({
    mutationFn: (data) => api.post('/api/email/send-exports', data),
  });
}

export function useEmailPreview() {
  return useMutation<EmailPreview, Error, string[]>({
    mutationFn: (filenames) => api.post('/api/email/preview', filenames),
  });
}
```

---

## 7. Frontend — Composant Settings (section email)

### `frontend/src/components/settings/EmailSettings.tsx` (nouveau fichier)

Section email à intégrer dans la page Paramètres existante.

**Fonctionnalités :**
- Input texte : `email_smtp_user` (Gmail expéditeur)
- Input password avec toggle œil (icône `Eye` / `EyeOff` Lucide) : `email_smtp_app_password`
- Input texte : `email_default_nom` (nom expéditeur, ex: "Dr Dupont")
- Zone chips pour `email_comptable_destinataires` :
  - Affichage en chips avec `×` pour supprimer
  - Input texte en fin de liste, validation email basique au Enter
  - Style chips : `bg-blue-500/10 text-blue-400 rounded-full px-3 py-1 text-sm`
- Bouton "Tester la connexion" (icône `CheckCircle` Lucide) → appelle `useTestEmailConnection`, toast succès/erreur
- Bouton "Sauvegarder" → appelle `PUT /api/settings` avec les champs email ajoutés
- Texte d'aide sous le password : "Google → Sécurité → Mots de passe des applications"

**Intégration :** Ajouter `<EmailSettings />` dans le composant SettingsPage existant, après les sections existantes, avec un titre de section `h2` "Email comptable" et une icône `Mail` Lucide.

---

## 8. Frontend — ExportPage (sélection multi + modale envoi)

### Modifications de `frontend/src/components/ExportPage.tsx`

**A. Ajouter la sélection multi-export :**

- State : `const [selectedExports, setSelectedExports] = useState<Set<string>>(new Set())`
- Chaque carte export ZIP existante reçoit une checkbox toggle (pattern identique aux checkboxes modernes de l'EditorPage : bouton 22px carré arrondi, `Check` icon blanc si coché, border colorée si décoché)
- Toolbar conditionnelle (visible quand `selectedExports.size > 0`) :
  - Checkbox "tout sélectionner" avec état intermédiaire (icône `Minus` si partiel, `Check` si tout)
  - Compteur : `{n} sélectionné(s)`
  - Bouton "Télécharger ({n})" avec icône `Download`
  - Bouton primaire "Envoyer au comptable ({n})" avec icône `Send` → ouvre la modale
- Les cartes sélectionnées ont `border: 2px solid var(--color-primary)` au lieu de la border par défaut

**B. Modale d'envoi email :**

### `frontend/src/components/exports/SendEmailModal.tsx` (nouveau fichier)

Props :
```typescript
interface SendEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFilenames: string[];
  exports: ExportInfo[];  // Pour afficher les tailles
}
```

**Contenu de la modale :**
- Header : icône `Send` + "Envoyer au comptable" + badge "{n} exports" + bouton `×`
- Champ "À" : chips pré-remplis depuis settings (`email_comptable_destinataires`), modifiables ponctuellement (ajout/suppression sans persister dans settings). Composant chips identique à `EmailSettings`.
- Champ "Objet" : input texte, pré-rempli via `useEmailPreview`
- Champ "Message" : textarea 5 lignes, pré-rempli via `useEmailPreview`
- Section "Pièces jointes" : liste des ZIPs avec nom + taille individuelle, taille totale en bas à droite. Si taille > 25 Mo : message erreur rouge.
- Footer : texte "Limite Gmail : 25 Mo" à gauche, boutons "Annuler" + "Envoyer ({n})" à droite
- Le bouton "Envoyer" :
  - Appelle `useSendExportsEmail`
  - Loading state avec spinner
  - Succès → toast succès `react-hot-toast` + ferme la modale + vide la sélection
  - Erreur → toast erreur

**Pattern modale :** Utiliser un overlay `fixed` avec fond semi-transparent + `div` centrée (max-width 540px). Fermeture au clic overlay + touche Escape.

---

## 9. Composant chips réutilisable (optionnel mais recommandé)

### `frontend/src/components/common/EmailChipsInput.tsx` (nouveau fichier)

Props :
```typescript
interface EmailChipsInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
}
```

- Affiche les emails en chips (`bg-blue-500/10 text-blue-400 rounded-full`)
- Input en fin de liste, ajout au Enter avec validation email regex basique
- Suppression au clic `×` ou Backspace sur input vide (supprime le dernier)
- Réutilisé dans `EmailSettings` et `SendEmailModal`

---

## Vérification

- [ ] `backend/models/email.py` créé avec les 3 modèles Pydantic
- [ ] Champs email ajoutés dans le modèle Settings existant (4 champs)
- [ ] `backend/services/email_service.py` créé avec `test_smtp_connection`, `send_exports_email`, `generate_email_subject`, `generate_email_body`
- [ ] `backend/routers/email.py` créé avec 3 endpoints (`test-connection`, `send-exports`, `preview`)
- [ ] Router email inclus dans `main.py`
- [ ] Types TypeScript ajoutés dans `types/index.ts`
- [ ] `useEmail.ts` créé avec 3 hooks (test, send, preview)
- [ ] `EmailChipsInput.tsx` créé et réutilisable
- [ ] `EmailSettings.tsx` créé et intégré dans la page Paramètres
- [ ] ExportPage modifiée : checkboxes sélection multi-ZIP + toolbar conditionnelle
- [ ] `SendEmailModal.tsx` créé avec pré-remplissage depuis settings + preview
- [ ] Bouton "Envoyer" désactivé si taille > 25 Mo
- [ ] Toast succès/erreur après envoi et test connexion
- [ ] `from __future__ import annotations` dans tous les fichiers Python
- [ ] Pas de `any` dans le TypeScript
- [ ] Dark theme respecté (CSS variables uniquement)
