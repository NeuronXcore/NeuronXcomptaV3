# Prompt Claude Code — Template HTML Email Comptable

## Contexte

Transformer l'email comptable actuellement envoyé en texte brut (`MIMEText plain`) en un email HTML professionnel avec en-tête brandé NeuronXcompta, arborescence du contenu ZIP, et signature app. Le template est généré dynamiquement côté backend.

Lire `CLAUDE.md` en premier.

---

## Ordre d'implémentation

1. Template HTML (nouveau fichier)
2. Modification `email_service.py` (generate_email_body → HTML + logos CID)
3. Modification `send_email()` (MIMEMultipart alternative + images CID)
4. Mise à jour preview frontend

---

## 1. Template HTML

### `backend/templates/email_template.html` (nouveau fichier)

Template Jinja2-style avec `str.format()` (pas de dépendance Jinja). Utiliser des placeholders `{variable}`.

**Structure HTML :**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">

<!-- EN-TÊTE ENTRE DEUX FILETS -->
<tr><td style="padding: 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td colspan="2" style="border-bottom: 2px solid #534AB7; height: 0; font-size: 0; line-height: 0;">&nbsp;</td></tr>
<tr><td style="padding: 14px 0; vertical-align: middle; width: 50px;">
  <!-- Logo principal embarqué en CID -->
  <img src="cid:logo_main" alt="NeuronXcompta" width="40" height="40" style="display: block; border-radius: 6px;" />
</td>
<td style="padding: 14px 0; vertical-align: middle;">
  <span style="font-size: 16px; font-weight: 500; color: #534AB7;">{titre_bandeau}</span>
</td></tr>
<tr><td colspan="2" style="border-bottom: 2px solid #534AB7; height: 0; font-size: 0; line-height: 0;">&nbsp;</td></tr>
</table>
</td></tr>

<!-- MENTION "EMAIL GÉNÉRÉ PAR" -->
<tr><td align="center" style="padding: 16px 28px 4px;">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align: middle; padding-right: 5px;">
  <img src="cid:logo_mark" alt="" width="16" height="16" style="display: block; border-radius: 3px;" />
</td>
<td style="vertical-align: middle;">
  <span style="font-size: 11px; color: #999999; font-style: italic;">Email généré par NeuronXcompta</span>
</td>
</tr>
</table>
</td></tr>

<!-- CORPS DU MESSAGE -->
<tr><td style="padding: 16px 28px 0;">
<p style="margin: 0 0 12px; font-size: 14px; color: #333333; line-height: 1.6;">Bonjour,</p>
<p style="margin: 0 0 16px; font-size: 14px; color: #333333; line-height: 1.6;">{introduction}</p>
</td></tr>

<!-- ARBORESCENCE ZIP -->
<tr><td style="padding: 0 28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f8f8; border-radius: 6px; border: 1px solid #e8e8e8;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0 0 6px; font-size: 13px; font-weight: 500; color: #333333; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">{zip_filename}</p>
<div style="padding-left: 12px; font-size: 12px; color: #666666; font-family: 'SF Mono', Monaco, 'Courier New', monospace; line-height: 1.8;">
{arborescence_lines}
</div>
</td></tr>
</table>
</td></tr>

<!-- SIGNATURE -->
<tr><td style="padding: 0 28px 24px;">
<p style="margin: 0 0 4px; font-size: 14px; color: #333333; line-height: 1.6;">Cordialement,</p>
<p style="margin: 0; font-size: 14px; font-weight: 500; color: #333333;">{signature}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
```

**Notes sur le template :**
- Utiliser des `<table>` imbriquées pour la compatibilité Gmail/Outlook (pas de flexbox/grid)
- Pas de CSS externe ni de `<style>` block (Gmail les supprime)
- Tout en inline styles
- Couleurs hardcodées (pas de CSS variables — email HTML ne supporte pas)
- Largeur fixe 600px (standard email)
- Le fond gris `#f5f5f5` encadre le bloc blanc

---

## 2. Backend — Fonctions de génération

### `backend/services/email_service.py`

#### Modifier `generate_email_body()` — renommer en `generate_email_html()`

**Nouvelle signature :**
```python
def generate_email_html(
    documents: list[DocumentRef],
    nom: Optional[str] = None,
    recap: Optional[dict] = None,
) -> str:
```

**Logique :**

1. **Déterminer le `titre_bandeau`** :
   - Si uniquement des exports : parser les mois depuis les noms de fichiers → `"Export comptable — Mars 2025"` ou `"Exports comptables — Février & Mars 2025"`
   - Si mix de types : `"Documents comptables — T1 2025"` ou `"Documents comptables — Mars 2025"`

2. **Générer l'`introduction`** :
   - Un seul export : `"Veuillez trouver ci-joint l'export comptable de mars 2025 sous forme d'archive ZIP contenant :"`
   - Plusieurs exports : `"Veuillez trouver ci-joints les exports comptables de février et mars 2025 sous forme d'archives ZIP contenant :"`
   - Mix de types : `"Veuillez trouver ci-joints les documents comptables de mars 2025 sous forme d'archive(s) ZIP contenant :"`

3. **Générer l'`arborescence_lines`** pour chaque ZIP :
   - Appeler `_build_zip_tree(zip_path)` (nouvelle fonction, voir ci-dessous)
   - Chaque ligne est un `<p>` avec style monospace
   - Utiliser les caractères `├─` et `└─` pour l'arborescence
   - Pour les sous-dossiers (Justificatifs/), lister les 3 premiers fichiers puis `… (N fichiers)` si plus de 3

4. **Assembler le template** :
   - Lire le fichier `backend/templates/email_template.html`
   - Remplacer les placeholders via `.format()` ou `.replace()`
   - Retourner le HTML complet

#### Nouvelle fonction `_build_zip_tree(zip_path: Path) -> tuple[str, str]`

```python
def _build_zip_tree(zip_path: Path) -> tuple[str, str]:
    """
    Lit le contenu d'un ZIP et génère l'arborescence HTML.
    
    Returns:
        tuple: (zip_filename, arborescence_html)
    """
```

**Logique :**
1. Ouvrir le ZIP avec `zipfile.ZipFile`
2. Lister tous les fichiers (`namelist()`)
3. Séparer les fichiers racine des fichiers dans des sous-dossiers
4. Construire l'arbre :
   - Fichiers racine : `├─ Export_Comptable_2025-03_Mars.csv`
   - Dernier fichier racine ou dossier : `└─ Justificatifs/`
   - Sous-fichiers : indentés avec `&nbsp;&nbsp;&nbsp;&nbsp;├─ facture_xxx.pdf`
   - Si > 3 fichiers dans un sous-dossier : `&nbsp;&nbsp;&nbsp;&nbsp;└─ … (N fichiers au total)`
5. Chaque ligne = `<p style="margin: 0;">├─ filename</p>`
6. Retourner `(zip_path.name, "\n".join(lines))`

**Si plusieurs ZIPs** : générer un bloc arborescence par ZIP, séparés par un `<br>`.

#### Conserver `generate_email_body()` comme wrapper texte brut

Garder l'ancienne fonction pour le fallback plain text (partie `alternative` du MIME) :

```python
def generate_email_body_plain(
    documents: list[DocumentRef],
    nom: Optional[str] = None,
) -> str:
    """Version plain text (fallback pour clients mail sans HTML)."""
    # Logique existante inchangée
```

---

## 3. Backend — Modification `send_email()`

### `backend/services/email_service.py`

**Modifications dans `send_email()` :**

1. **Construire un `MIMEMultipart("related")`** au lieu de `MIMEMultipart("mixed")` :
   ```python
   msg = MIMEMultipart("related")
   
   # Sous-partie alternative (HTML + plain text)
   msg_alt = MIMEMultipart("alternative")
   msg.attach(msg_alt)
   
   # Plain text fallback
   plain_body = generate_email_body_plain(documents, nom)
   msg_alt.attach(MIMEText(plain_body, "plain", "utf-8"))
   
   # HTML
   html_body = generate_email_html(documents, nom, recap)
   msg_alt.attach(MIMEText(html_body, "html", "utf-8"))
   ```

2. **Embarquer les logos en CID** :
   ```python
   from email.mime.image import MIMEImage
   
   # Logo principal (40x40 dans le bandeau)
   logo_main_path = Path("backend/assets/logo.png")  # Logo existant
   if logo_main_path.exists():
       with open(logo_main_path, "rb") as f:
           logo_img = MIMEImage(f.read(), _subtype="png")
           logo_img.add_header("Content-ID", "<logo_main>")
           logo_img.add_header("Content-Disposition", "inline", filename="logo.png")
           msg.attach(logo_img)
   
   # Logo mark 16x16 (mention "généré par")
   logo_mark_path = Path("backend/assets/logo_mark_64.png")
   if logo_mark_path.exists():
       with open(logo_mark_path, "rb") as f:
           mark_img = MIMEImage(f.read(), _subtype="png")
           mark_img.add_header("Content-ID", "<logo_mark>")
           mark_img.add_header("Content-Disposition", "inline", filename="logo_mark.png")
           msg.attach(mark_img)
   ```

3. **Attacher les pièces jointes APRÈS les images CID** :
   ```python
   # Les documents ZIP/PDF en pièces jointes normales
   for doc in documents:
       path = _resolve_document_path(doc)
       # ... attachment logic existante inchangée
   ```

**Structure MIME finale :**
```
MIMEMultipart("related")
├── MIMEMultipart("alternative")
│   ├── MIMEText("plain")      ← fallback texte brut
│   └── MIMEText("html")       ← template HTML
├── MIMEImage (logo_main, CID)  ← logo bandeau
├── MIMEImage (logo_mark, CID)  ← mini-logo signature
├── MIMEBase (ZIP attachment)   ← pièce jointe 1
└── MIMEBase (ZIP attachment)   ← pièce jointe 2 (si multi)
```

---

## 4. Backend — Répertoire templates

### Créer `backend/templates/` (nouveau dossier)

- Y placer le fichier `email_template.html`
- Le charger dans `generate_email_html()` via :
  ```python
  TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
  
  def _load_email_template() -> str:
      template_path = TEMPLATE_DIR / "email_template.html"
      return template_path.read_text(encoding="utf-8")
  ```

---

## 5. Frontend — Mise à jour preview

### `backend/routers/email.py`

Modifier l'endpoint `POST /preview` pour retourner aussi le HTML :

```python
@router.post("/preview")
async def preview_email(request: EmailPreviewRequest):
    settings = settings_service.load_settings()
    nom = settings.get("email_default_nom")
    
    objet = email_service.generate_email_subject(request.documents, nom)
    corps_plain = email_service.generate_email_body_plain(request.documents, nom)
    corps_html = email_service.generate_email_html(request.documents, nom)
    
    return {
        "destinataires": settings.get("email_comptable_destinataires", []),
        "objet": objet,
        "corps": corps_plain,
        "corps_html": corps_html,
    }
```

### Frontend — `SendToAccountantDrawer.tsx`

Dans la zone de preview du message :
- Ajouter un toggle "Texte / HTML" (deux petits boutons inline) au-dessus du textarea
- Mode texte : textarea éditable (comportement actuel)
- Mode HTML : `<iframe srcDoc={corpsHtml} />` en lecture seule, même dimensions que le textarea
- Le toggle est purement cosmétique (preview) — l'envoi utilise toujours les deux versions (HTML + plain text)

```typescript
// Ajouter au state du composant
const [previewMode, setPreviewMode] = useState<'text' | 'html'>('html');

// Dans le JSX, au-dessus du textarea :
<div className="flex gap-1 mb-2">
  <button
    className={cn(
      "text-xs px-2 py-1 rounded",
      previewMode === 'text' ? "bg-primary text-white" : "text-text-muted"
    )}
    onClick={() => setPreviewMode('text')}
  >
    Texte
  </button>
  <button
    className={cn(
      "text-xs px-2 py-1 rounded",
      previewMode === 'html' ? "bg-primary text-white" : "text-text-muted"
    )}
    onClick={() => setPreviewMode('html')}
  >
    HTML
  </button>
</div>

{previewMode === 'text' ? (
  <textarea ... />  // existant
) : (
  <iframe
    srcDoc={preview?.corps_html}
    className="w-full border border-border-tertiary rounded-lg"
    style={{ height: '320px' }}
    sandbox=""
    title="Aperçu email HTML"
  />
)}
```

### Types — `frontend/src/types/index.ts`

Ajouter `corps_html` au type `EmailPreview` :

```typescript
export interface EmailPreview {
  destinataires: string[];
  objet: string;
  corps: string;
  corps_html: string;  // ← nouveau
}
```

---

## 6. Gestion des cas multi-documents

### Plusieurs exports (multi-ZIP)

Quand `documents` contient plusieurs exports ZIP :
- `titre_bandeau` : `"Exports comptables — Février & Mars 2025"`
- `introduction` : `"Veuillez trouver ci-joints les exports comptables de février et mars 2025 sous forme d'archives ZIP contenant :"`
- **Une arborescence par ZIP**, chacune dans son propre bloc `<table>` gris avec le nom du ZIP en titre
- Séparer les blocs par 8px de padding

### Mix exports + rapports + autres

Quand `documents` contient des types différents :
- `titre_bandeau` : `"Documents comptables — Mars 2025"` (ou `"— T1 2025"` si multi-mois)
- `introduction` : `"Veuillez trouver ci-joints les documents comptables suivants :"`
- Arborescence uniquement pour les ZIPs (les autres fichiers n'ont pas d'arborescence interne)
- Lister les fichiers non-ZIP sous l'arborescence dans un bloc séparé :
  ```
  Autres documents joints :
  • Rapport_BNC_Annuel_2025.pdf (0.3 Mo)
  • Rapport_Ventilation_T1_2025.pdf (0.2 Mo)
  ```

### Document unique non-ZIP

Si un seul document non-ZIP est envoyé (ex: un rapport PDF seul) :
- Pas de bloc arborescence
- `introduction` : `"Veuillez trouver ci-joint le rapport [nom] de [période]."`

---

## Vérification

- [ ] `backend/templates/email_template.html` créé avec layout tables (compatible Gmail/Outlook)
- [ ] `generate_email_html()` créée dans `email_service.py`
- [ ] `_build_zip_tree()` créée — lit le ZIP réel et génère l'arborescence HTML
- [ ] `generate_email_body()` existante renommée en `generate_email_body_plain()` (ou conservée comme alias)
- [ ] `send_email()` modifié : `MIMEMultipart("related")` + alternative (plain + HTML) + images CID + attachments
- [ ] Logo principal embarqué en CID depuis `backend/assets/logo.png` (`Content-ID: <logo_main>`)
- [ ] Logo mark embarqué en CID depuis `backend/assets/logo_mark_64.png` (`Content-ID: <logo_mark>`)
- [ ] Vérifier que les deux fichiers logo existent dans `backend/assets/` — si `logo_mark_64.png` n'existe pas, le générer par redimensionnement de `logo.png` à 64x64 via Pillow
- [ ] Endpoint `POST /preview` retourne `corps_html` en plus de `corps`
- [ ] `EmailPreview` TypeScript mis à jour avec `corps_html: string`
- [ ] Toggle texte/HTML ajouté dans `SendToAccountantDrawer.tsx` avec iframe `srcDoc`
- [ ] Arborescence dynamique : reflète le contenu réel du ZIP (pas hardcodé)
- [ ] Multi-ZIP : un bloc arborescence par ZIP
- [ ] Mix de types : arborescence pour les ZIPs, liste pour les autres
- [ ] Fallback : si un logo n'existe pas, le template HTML fonctionne sans (pas de placeholder cassé)
- [ ] `from __future__ import annotations` dans tous les fichiers Python modifiés/créés
- [ ] Pas de `any` TypeScript
- [ ] Import `zipfile` ajouté dans `email_service.py`
