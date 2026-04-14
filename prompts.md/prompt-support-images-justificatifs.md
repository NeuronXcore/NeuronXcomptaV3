# Prompt Claude Code — Support images justificatifs (JPG/PNG → PDF)

> Lis `CLAUDE.md` en premier pour charger les contraintes projet.

## Objectif

Permettre l'import de justificatifs au format image (JPG, JPEG, PNG) **en plus** du PDF. Les images sont **converties en PDF à l'intake** via Pillow (`PIL`) pour uniformiser le stockage. Tout le pipeline aval (OCR, preview, rapprochement, export) reste inchangé.

## Principe

```
Image uploadée (.jpg/.jpeg/.png)
  → Pillow: Image.open() → .convert('RGB') → .save(format='PDF')
  → Fichier PDF stocké normalement
  → Pipeline OCR existant (pdf2image → EasyOCR)
  → Preview iframe existant
  → Export ZIP existant
```

Le fichier image original n'est PAS conservé. Seul le PDF converti est stocké.

---

## Modifications Backend

### 1. `backend/services/justificatif_service.py`

#### Nouvelle fonction helper

```python
from PIL import Image
import io

ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png'}

def _convert_image_to_pdf(image_bytes: bytes) -> bytes:
    """Convertit des bytes image (JPG/PNG) en bytes PDF via Pillow."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode in ('RGBA', 'P', 'LA'):
        img = img.convert('RGB')
    pdf_buffer = io.BytesIO()
    img.save(pdf_buffer, format='PDF')
    pdf_buffer.seek(0)
    return pdf_buffer.read()
```

#### Modifier `upload_justificatifs()` (ou la fonction d'upload existante)

- Élargir la validation : accepter les fichiers dont l'extension est dans `ALLOWED_EXTENSIONS`
- Élargir la validation magic bytes :
  - PDF : `%PDF-` (existant)
  - JPEG : `b'\xff\xd8\xff'`
  - PNG : `b'\x89PNG'`
- Si le fichier est une image (extension dans `IMAGE_EXTENSIONS`) :
  - Convertir via `_convert_image_to_pdf()`
  - Remplacer l'extension dans le nom de destination par `.pdf`
  - Les bytes sauvegardés sont ceux du PDF converti
- Le reste du pipeline (nommage `justificatif_YYYYMMDD_HHMMSS_nom.pdf`, sauvegarde dans `en_attente/`) est inchangé

### 2. `backend/routers/ocr.py`

#### `POST /batch-upload`

- Élargir la validation du content-type : accepter `application/pdf`, `image/jpeg`, `image/png`
- Élargir la validation magic bytes (même logique que ci-dessus)
- Si image → convertir en PDF avant de passer au service OCR
- Le résultat filename doit toujours avoir l'extension `.pdf`

#### `POST /extract-upload`

- Même élargissement : accepter images, convertir en PDF avant extraction OCR

### 3. `backend/services/sandbox_service.py`

#### Modifier le watchdog handler

- Élargir le filtre de fichiers surveillés : `.pdf`, `.jpg`, `.jpeg`, `.png`
- Si le fichier détecté est une image :
  - Lire le fichier
  - Convertir via `_convert_image_to_pdf()`
  - Écrire le PDF résultant dans `en_attente/` (avec extension `.pdf`)
  - Supprimer l'image originale du sandbox
- Si PDF : comportement existant (move direct)
- Le reste du pipeline (OCR, SSE) est inchangé

### 4. `backend/core/config.py`

Ajouter des constantes (si elles n'existent pas déjà) :

```python
ALLOWED_JUSTIFICATIF_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png'}
MAGIC_BYTES = {
    'pdf': b'%PDF-',
    'jpeg': b'\xff\xd8\xff',
    'png': b'\x89PNG',
}
```

---

## Modifications Frontend

### 5. `frontend/src/components/ocr/OcrPage.tsx`

Dans la zone de drag & drop (react-dropzone), modifier le `accept` :

```typescript
accept: {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
}
```

Modifier le texte d'aide pour indiquer : "PDF, JPG ou PNG (max 10 Mo)".

### 6. Tout autre composant frontend avec upload de justificatifs

Rechercher tous les composants qui ont un `accept` limité à PDF et élargir de la même façon. Vérifier en particulier :
- `JustificatifsPage.tsx` (s'il reste un bouton upload)
- Tout composant dropzone ou input file lié aux justificatifs

---

## Ce qui NE change PAS

- **Pipeline OCR** (`ocr_service.py`) : reçoit toujours un PDF → `pdf2image` → EasyOCR
- **Preview justificatifs** : toujours `<iframe>` sur un PDF
- **Rapprochement** : scoring inchangé
- **Export ZIP** : toujours des PDF dans l'archive
- **Lettrage, clôture** : aucun impact
- **Modèles Pydantic** : aucun changement

---

## Vérifications

- [ ] Upload d'un JPG via OCR batch → converti en PDF, OCR fonctionne, preview iframe OK
- [ ] Upload d'un PNG (avec transparence/RGBA) via OCR batch → conversion RGB → PDF OK
- [ ] Upload d'un PDF → comportement inchangé
- [ ] Dépôt d'un JPG dans sandbox → converti en PDF, déplacé en_attente, OCR + SSE OK
- [ ] Dépôt d'un PNG dans sandbox → idem
- [ ] Test OCR manuel (extract-upload) avec une image → fonctionne
- [ ] Fichier non supporté (`.txt`, `.docx`) → rejeté avec erreur claire
- [ ] Magic bytes invalides (fichier renommé) → rejeté
- [ ] `from __future__ import annotations` présent dans tout fichier backend modifié
- [ ] Aucun `any` TypeScript introduit
