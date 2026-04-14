# Fix : Remplacer les `<object>` PDF par des `<img>` thumbnail dans les vues liste/grille

## Contexte

Les previews PDF utilisant `<object type="application/pdf">` causent des pertes d'aperçu dans le navigateur (plugin PDF déchargé silencieusement, nécessite hard refresh). Le backend dispose déjà de l'endpoint `GET /api/ged/documents/{doc_id}/thumbnail` qui génère et cache des PNG 200px dans `data/ged/thumbnails/`.

## Objectif

Remplacer tous les `<object type="application/pdf">` par des `<img>` pointant vers l'endpoint thumbnail **dans les vues liste/grille uniquement**. Conserver `<object>` PDF dans les drawers de détail (instance unique, pas de problème).

## Périmètre

### 1. Composants à migrer vers `<img>` thumbnail

Rechercher dans tout le frontend les usages de `<object type="application/pdf">` et `<iframe` pointant vers des endpoints `/preview`. Pour chaque occurrence, déterminer si c'est une vue **liste/grille** (migrer) ou un **drawer de détail** (conserver).

Composants probablement concernés :

- **`GedDocumentCard`** — carte dans la grille GED → utiliser `<img src="/api/ged/documents/${doc.id}/thumbnail" />`
- **`JustificatifAttributionDrawer`** — panneau gauche, hover 300ms sur les suggestions → remplacer le preview PDF hover par un `<img>` thumbnail
- **Historique OCR** — popover hover 300×400px avec iframe PDF → remplacer par `<img>` thumbnail (le clic peut ouvrir le PDF complet dans le drawer)
- **`RapprochementManuelDrawer`** — liste scorée avec preview → si la preview est dans la liste (pas le panneau principal), migrer vers thumbnail

### 2. Drawers à NE PAS modifier (garder `<object>` PDF)

- `JustificatifAttributionDrawer` — **panneau droit** (le grand `<object>` PDF du split resizable) → conserver
- `GedDocumentDrawer` — preview PDF pleine page → conserver
- `GedReportDrawer` — preview PDF → conserver
- `ReportPreviewDrawer` — preview PDF → conserver
- `ReconstituerDrawer` — preview template → conserver

### 3. Composant réutilisable `PdfThumbnail`

Créer un composant réutilisable :

```tsx
// frontend/src/components/ui/PdfThumbnail.tsx

interface PdfThumbnailProps {
  /** doc_id pour l'endpoint GED, OU filename pour les justificatifs */
  docId?: string;
  justificatifFilename?: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
}

export function PdfThumbnail({ docId, justificatifFilename, alt, className, onClick }: PdfThumbnailProps) {
  // Construire l'URL :
  // - Si docId : `/api/ged/documents/${encodeURIComponent(docId)}/thumbnail`
  // - Si justificatifFilename : `/api/justificatifs/${encodeURIComponent(justificatifFilename)}/thumbnail`
  //   (voir étape 4 si cet endpoint n'existe pas encore)
  
  // État : loading | loaded | error
  // onError → afficher placeholder Lucide <FileText /> avec fond gris
  // onLoad → afficher l'image
  // loading → spinner ou skeleton
  
  return (
    <div className={`relative overflow-hidden rounded ${className}`} onClick={onClick}>
      {/* loading skeleton */}
      <img
        src={url}
        alt={alt || 'Aperçu document'}
        className="w-full h-full object-cover"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        loading="lazy" // lazy loading natif navigateur
      />
      {/* fallback error : icône FileText centrée sur fond surface */}
    </div>
  );
}
```

### 4. Backend — Endpoint thumbnail justificatifs (si absent)

Vérifier si l'endpoint `/api/justificatifs/{filename}/thumbnail` existe. Si non, l'ajouter dans `justificatifs.py` :

```python
@router.get("/{filename}/thumbnail")
async def get_justificatif_thumbnail(filename: str):
    """Thumbnail PNG 200px de la première page du justificatif."""
    # Chercher le PDF dans en_attente/ puis traites/
    pdf_path = _find_justificatif_path(filename)
    if not pdf_path:
        raise HTTPException(404, "Justificatif non trouvé")
    
    # Réutiliser la logique de ged_service ou la factoriser
    # Cache dans data/ged/thumbnails/ (même répertoire que la GED)
    thumbnail_path = THUMBNAILS_DIR / f"{filename}.png"
    if not thumbnail_path.exists():
        from pdf2image import convert_from_path
        images = convert_from_path(str(pdf_path), first_page=1, last_page=1, dpi=72, size=(200, None))
        if images:
            images[0].save(str(thumbnail_path), "PNG")
    
    if not thumbnail_path.exists():
        raise HTTPException(404, "Impossible de générer le thumbnail")
    
    return FileResponse(thumbnail_path, media_type="image/png")
```

**Alternative plus simple** : si les justificatifs sont déjà indexés dans la GED, utiliser directement `/api/ged/documents/{doc_id}/thumbnail` partout. Vérifier quel `doc_id` utiliser (le nom de fichier est souvent le `doc_id` dans la GED).

### 5. Factoriser la génération de thumbnails

Si la logique de génération thumbnail est dupliquée entre `ged_service` et le nouvel endpoint justificatifs, extraire une fonction utilitaire :

```python
# backend/services/thumbnail_service.py

THUMBNAILS_DIR = Path("data/ged/thumbnails")

def get_or_create_thumbnail(pdf_path: Path, cache_key: str, width: int = 200) -> Path | None:
    """Génère et cache un thumbnail PNG. Retourne le path ou None."""
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    thumb = THUMBNAILS_DIR / f"{cache_key}.png"
    if thumb.exists():
        return thumb
    try:
        from pdf2image import convert_from_path
        images = convert_from_path(str(pdf_path), first_page=1, last_page=1, dpi=72, size=(width, None))
        if images:
            images[0].save(str(thumb), "PNG")
            return thumb
    except Exception:
        pass
    return None
```

## Étapes d'implémentation (ordre)

1. **Créer `thumbnail_service.py`** avec `get_or_create_thumbnail()`
2. **Refactorer `ged_service`** pour utiliser `thumbnail_service`
3. **Ajouter endpoint `/api/justificatifs/{filename}/thumbnail`** (si nécessaire, sinon utiliser la GED)
4. **Créer `PdfThumbnail.tsx`** composant réutilisable
5. **Migrer `GedDocumentCard`** : `<object>` → `<PdfThumbnail>`
6. **Migrer hover previews** dans `JustificatifAttributionDrawer` (suggestions)
7. **Migrer hover OCR** dans l'historique OCR
8. **Migrer `RapprochementManuelDrawer`** si applicable (liste uniquement)
9. **Tester** : naviguer dans la GED avec 50+ documents, aucun thumbnail ne doit disparaître

## Vérification

- [ ] Aucun `<object type="application/pdf">` restant dans les vues liste/grille
- [ ] `<object>` PDF conservé uniquement dans les drawers de détail (panneau droit, preview pleine page)
- [ ] `PdfThumbnail` affiche un placeholder `FileText` en cas d'erreur (404, non-PDF)
- [ ] `loading="lazy"` sur toutes les `<img>` thumbnail
- [ ] Pas de hard refresh nécessaire après navigation intensive
- [ ] Le dossier `data/ged/thumbnails/` est utilisé comme cache partagé
- [ ] Les thumbnails justificatifs (en_attente + traités) fonctionnent
