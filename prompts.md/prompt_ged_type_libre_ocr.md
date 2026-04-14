# Prompt Claude Code — GED : Type de document libre + OCR automatique à l'upload

## Contexte

Lis `CLAUDE.md` en premier pour charger les contraintes du projet.

NeuronXcompta V3 a un module GED (Bibliothèque Documents) déjà implémenté. Deux améliorations à apporter :

1. **Type de document libre** : remplacer le `<select>` fermé (enum) par un champ texte libre avec autocomplétion sur les types déjà utilisés
2. **OCR automatique** : déclencher le pipeline OCR existant à chaque upload de document dans la GED, créer le `.ocr.json` à côté du fichier

---

## 1. Backend — Type de document libre

### `backend/models/ged.py` (ou fichier modèle GED existant)

Modifier le champ `type` du modèle Pydantic pour qu'il accepte n'importe quelle string, pas une enum :

```python
from __future__ import annotations
from typing import Optional, List

class GedDocumentMetadata(BaseModel):
    type: str = "divers"  # String libre, plus d'enum
    year: int
    month: int
    tags: List[str] = []
    notes: str = ""
    added_at: str = ""
    poste_comptable: Optional[str] = None
    poste_analytique: Optional[str] = None
    ocr_file: Optional[str] = None  # chemin vers le .ocr.json
```

Si un `Enum` ou `Literal` contraignait le type, **le supprimer**.

### `backend/services/ged_service.py`

Ajouter une fonction pour extraire les types distincts depuis `ged_metadata.json` :

```python
def get_distinct_types() -> list[str]:
    """Retourne tous les types de documents uniques déjà utilisés, triés alphabétiquement."""
    metadata = _load_metadata()
    types = set()
    for doc in metadata.get("documents", {}).values():
        doc_type = doc.get("type", "").strip()
        if doc_type:
            types.add(doc_type)
    # Ajouter les types suggérés par défaut s'ils ne sont pas déjà présents
    defaults = {"relevé", "justificatif", "rapport", "contrat", "courrier fiscal",
                "courrier social", "attestation", "devis", "divers"}
    types.update(defaults)
    return sorted(types)
```

### `backend/services/ged_service.py` — OCR à l'upload

Dans la fonction d'upload (`upload_document` ou équivalent), après la sauvegarde du fichier physique dans `data/ged/{year}/{month}/`, ajouter l'appel OCR :

```python
from backend.services.ocr_service import extract_or_cached

def upload_document(file, metadata: dict) -> dict:
    # ... sauvegarde existante du fichier dans data/ged/{year}/{month}/ ...
    saved_path = ...  # chemin complet du fichier sauvegardé

    # OCR automatique (PDF et images)
    ocr_result = None
    ext = Path(saved_path).suffix.lower()
    if ext in ('.pdf', '.jpg', '.jpeg', '.png'):
        try:
            ocr_result = extract_or_cached(str(saved_path))
            # Le .ocr.json est créé automatiquement par extract_or_cached
            ocr_json_path = str(saved_path) + '.ocr.json'
            if Path(ocr_json_path).exists():
                # Mettre à jour le champ ocr_file dans la metadata
                _update_document_metadata(saved_path, {"ocr_file": ocr_json_path})
        except Exception as e:
            # OCR en erreur ne bloque pas l'upload
            import logging
            logging.getLogger(__name__).warning(f"OCR échoué pour {saved_path}: {e}")

    return {
        "filename": Path(saved_path).name,
        "path": str(saved_path),
        "ocr_success": ocr_result is not None,
        "ocr_data": ocr_result
    }
```

**Important** : `extract_or_cached` du `ocr_service` existant gère déjà le cache `.ocr.json` et supporte PDF (via pdf2image) et images (si le support images a été ajouté). Si le support images n'est pas encore implémenté dans `ocr_service`, ajouter la détection :

```python
# Dans ocr_service.py, dans extract_or_cached() :
def extract_or_cached(filepath: str) -> dict:
    # ... vérif cache existante ...
    
    ext = Path(filepath).suffix.lower()
    if ext in ('.jpg', '.jpeg', '.png'):
        # Image → directement EasyOCR sans pdf2image
        from PIL import Image
        img = Image.open(filepath)
        images = [img]
    elif ext == '.pdf':
        # PDF → pipeline existant pdf2image
        images = convert_from_path(filepath)
    else:
        raise ValueError(f"Format non supporté: {ext}")
    
    # ... suite du pipeline EasyOCR existant ...
```

### `backend/routers/ged.py`

Ajouter l'endpoint pour les types distincts :

```python
@router.get("/types")
async def get_document_types():
    """Retourne les types de documents distincts pour l'autocomplétion."""
    return ged_service.get_distinct_types()
```

Modifier l'endpoint upload pour accepter aussi les images :

```python
@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    type: str = Form("divers"),          # String libre
    year: int = Form(...),
    month: int = Form(...),
    tags: str = Form(""),                # CSV string → split en liste
    notes: str = Form(""),
    poste_comptable: Optional[str] = Form(None),
    poste_analytique: Optional[str] = Form(None),
):
    # Validation format fichier
    content = await file.read()
    is_pdf = content[:5] == b'%PDF-'
    is_jpeg = content[:3] == b'\xff\xd8\xff'
    is_png = content[:4] == b'\x89PNG'
    if not (is_pdf or is_jpeg or is_png):
        raise HTTPException(400, "Format non supporté. Accepté : PDF, JPG, PNG.")
    await file.seek(0)

    metadata = {
        "type": type.strip(),
        "year": year,
        "month": month,
        "tags": [t.strip() for t in tags.split(",") if t.strip()] if tags else [],
        "notes": notes,
        "poste_comptable": poste_comptable,
        "poste_analytique": poste_analytique,
    }
    result = ged_service.upload_document(file, metadata)
    return result
```

---

## 2. Frontend — Type libre avec autocomplétion

### `frontend/src/hooks/useGed.ts`

Ajouter le query pour récupérer les types :

```typescript
export function useGedTypes() {
  return useQuery<string[]>({
    queryKey: ['ged-types'],
    queryFn: () => api.get('/ged/types'),
  })
}
```

### Composant d'upload (dans `GedUploadZone.tsx` ou `GedMetadataEditor.tsx`)

Remplacer le `<select>` du champ type par un **input texte avec datalist** HTML natif (pas besoin de lib externe) :

```tsx
// Dans le composant d'upload ou le formulaire metadata
const { data: types = [] } = useGedTypes()
const [docType, setDocType] = useState('divers')

// JSX
<div>
  <label className="block text-sm text-text-muted mb-1">Type de document</label>
  <input
    type="text"
    list="ged-type-suggestions"
    value={docType}
    onChange={(e) => setDocType(e.target.value)}
    placeholder="Ex: courrier CARMF, devis travaux, PV assemblée..."
    className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text
               placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
  />
  <datalist id="ged-type-suggestions">
    {types.map((t) => (
      <option key={t} value={t} />
    ))}
  </datalist>
</div>
```

**Pourquoi `datalist`** : natif HTML, zéro dépendance, fonctionne comme une autocomplétion — l'utilisateur peut taper librement ou choisir une suggestion. Les types déjà utilisés + les defaults apparaissent dans la dropdown.

### Dropzone — Accepter les images

Dans le `react-dropzone` config, élargir `accept` :

```typescript
const { getRootProps, getInputProps } = useDropzone({
  accept: {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
  },
  // ... reste de la config
})
```

### Preview — Images vs PDF

Dans le drawer preview (`GedDocumentDrawer.tsx`), adapter selon le type de fichier :

```tsx
const isImage = filename.match(/\.(jpg|jpeg|png)$/i)

{isImage ? (
  <img
    src={`/api/ged/${encodeURIComponent(docId)}/preview`}
    alt={filename}
    className="w-full h-auto rounded"
  />
) : (
  <iframe
    src={`/api/ged/${encodeURIComponent(docId)}/preview`}
    className="w-full h-full border-0"
    title={filename}
  />
)}
```

### Mutation upload — Envoyer le type comme string

Dans la mutation d'upload (hook `useGed.ts`), s'assurer que le FormData envoie `type` comme string libre :

```typescript
export function useGedUpload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      file: File
      type: string        // string libre
      year: number
      month: number
      tags?: string[]
      notes?: string
      poste_comptable?: string
      poste_analytique?: string
    }) => {
      const formData = new FormData()
      formData.append('file', params.file)
      formData.append('type', params.type)
      formData.append('year', String(params.year))
      formData.append('month', String(params.month))
      if (params.tags?.length) formData.append('tags', params.tags.join(','))
      if (params.notes) formData.append('notes', params.notes)
      if (params.poste_comptable) formData.append('poste_comptable', params.poste_comptable)
      if (params.poste_analytique) formData.append('poste_analytique', params.poste_analytique)
      return api.upload('/ged/upload', formData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
      queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
      queryClient.invalidateQueries({ queryKey: ['ged-types'] })  // Rafraîchir la liste des types
      queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Document ajouté avec OCR')
    },
    onError: () => {
      toast.error("Erreur lors de l'upload")
    },
  })
}
```

---

## 3. Ordre d'implémentation

1. `backend/models/ged.py` — supprimer l'enum, passer `type` en `str`
2. `backend/services/ged_service.py` — ajouter `get_distinct_types()`, modifier `upload_document()` pour l'OCR auto
3. `backend/services/ocr_service.py` — ajouter support images si pas encore fait (détection `ext` → PIL direct)
4. `backend/routers/ged.py` — ajouter `GET /types`, modifier upload pour accepter images + type string
5. `frontend/src/hooks/useGed.ts` — ajouter `useGedTypes()`, modifier `useGedUpload()`
6. Composant upload frontend — remplacer `<select>` par `<input>` + `<datalist>`
7. Composant preview — conditionnel image/PDF

---

## 4. Vérifications

Après implémentation, vérifie :

- [ ] `GET /api/ged/types` retourne une liste de strings incluant les defaults (relevé, justificatif, rapport, contrat, etc.)
- [ ] `POST /api/ged/upload` accepte un `type` libre (ex: "courrier CARMF", "PV assemblée SCP")
- [ ] `POST /api/ged/upload` accepte les fichiers JPG/PNG en plus de PDF
- [ ] Après upload, un fichier `.ocr.json` est créé à côté du document uploadé
- [ ] La réponse de l'upload contient `ocr_success: true` et `ocr_data` avec les infos extraites
- [ ] Le champ `ocr_file` est renseigné dans `ged_metadata.json` après upload
- [ ] Le formulaire frontend affiche les suggestions d'autocomplétion (datalist)
- [ ] Un type nouveau saisi manuellement apparaît dans les suggestions aux uploads suivants
- [ ] Le preview fonctionne pour les images (balise `<img>`) et les PDF (`<iframe>`)
- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] L'OCR en erreur ne bloque pas l'upload (catch + warning log)
- [ ] Dark theme respecté partout (CSS variables `bg-surface`, `text-text`, `border-border`)
