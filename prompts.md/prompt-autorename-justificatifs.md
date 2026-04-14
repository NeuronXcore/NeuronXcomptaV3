# Prompt — Auto-rename justificatifs post-OCR + rename frontend

> Lire CLAUDE.md avant toute implémentation.

## Contexte

Actuellement les justificatifs déposés dans la sandbox doivent être nommés manuellement selon la convention `fournisseur_YYYYMMDD_montant.pdf` avant dépôt. L'OCR extrait déjà ces 3 champs (supplier, best_date, best_amount). On veut inverser la logique : déposer avec n'importe quel nom → OCR → auto-rename selon la convention → possibilité de corriger le nom depuis le frontend.

## Périmètre

1. **Backend** — Fonction utilitaire `build_convention_filename()` + `rename_justificatif()`
2. **Backend** — Auto-rename dans `sandbox_service._process_file()` et `ocr.batch_upload()`
3. **Backend** — Endpoint `POST /api/justificatifs/{filename}/rename`
4. **Frontend** — Composant `FilenameEditor` (inline editable) dans l'historique OCR et le drawer justificatif
5. **SSE** — L'événement sandbox porte le `new_filename` après rename

## Ordre d'implémentation

### Étape 1 — Utilitaires backend

**Fichier : `backend/services/naming_service.py`** (nouveau)

```python
from __future__ import annotations
import re
import unicodedata
from pathlib import Path
from typing import Optional

def normalize_supplier(raw: str) -> str:
    """
    Normalise le nom fournisseur pour le filename.
    - lowercase
    - supprime accents (NFD + strip combining)
    - remplace espaces/points/tirets multiples par un seul tiret
    - supprime caractères non-alphanumériques (sauf tiret)
    - strip tirets en début/fin
    - max 30 caractères
    """
    s = raw.lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)  # strip accents
    s = re.sub(r"[\s.\-_]+", "-", s)        # spaces/dots/dashes → single dash
    s = re.sub(r"[^a-z0-9\-]", "", s)       # keep alphanum + dash only
    s = s.strip("-")
    return s[:30] or "inconnu"


def build_convention_filename(
    supplier: Optional[str],
    date_str: Optional[str],   # format "YYYY-MM-DD"
    amount: Optional[float],
) -> Optional[str]:
    """
    Construit le nom selon la convention fournisseur_YYYYMMDD_montant.pdf
    Retourne None si date OU montant manquants (supplier fallback "inconnu").
    Le montant utilise une virgule comme séparateur décimal.
    """
    if not date_str or amount is None:
        return None

    clean_supplier = normalize_supplier(supplier or "inconnu")
    date_compact = date_str.replace("-", "")  # "20250409"

    # Formater montant : 1439.87 → "1439,87"
    amount_str = f"{abs(amount):.2f}".replace(".", ",")

    return f"{clean_supplier}_{date_compact}_{amount_str}.pdf"


def deduplicate_filename(target_dir: Path, desired_name: str) -> str:
    """
    Si desired_name existe déjà dans target_dir, ajoute un suffixe _2, _3, etc.
    """
    if not (target_dir / desired_name).exists():
        return desired_name

    stem = Path(desired_name).stem
    suffix = Path(desired_name).suffix
    counter = 2
    while (target_dir / f"{stem}_{counter}{suffix}").exists():
        counter += 1
    return f"{stem}_{counter}{suffix}"
```

**Tests unitaires** pour `normalize_supplier` :
- `"Amazon.fr"` → `"amazon-fr"`
- `"Crédit Agricole"` → `"credit-agricole"`
- `"FCE Bank plc"` → `"fce-bank-plc"`
- `"URSSAF Île-de-France"` → `"urssaf-ile-de-france"`
- `""` → `"inconnu"`

**Tests unitaires** pour `build_convention_filename` :
- `("Amazon", "2025-04-09", 1439.87)` → `"amazon_20250409_1439,87.pdf"`
- `(None, "2025-04-09", 50.00)` → `"inconnu_20250409_50,00.pdf"`
- `("Test", None, 100.0)` → `None`
- `("Test", "2025-01-01", None)` → `None`

---

### Étape 2 — Service de renommage

**Fichier : `backend/services/justificatif_service.py`** (fonctions à ajouter)

```python
from backend.services.naming_service import build_convention_filename, deduplicate_filename, normalize_supplier

def rename_justificatif(old_filename: str, new_filename: str) -> dict:
    """
    Renomme un justificatif (PDF + .ocr.json) dans en_attente/ ou traites/.
    Met à jour :
    1. Le fichier PDF
    2. Le .ocr.json associé (+ champ "renamed_from" pour traçabilité)
    3. Les associations dans les fichiers d'opérations (champ justificatif_file)
    4. Les metadata GED si existantes
    
    Retourne {"old": old_filename, "new": final_filename, "location": "en_attente"|"traites"}
    Raise HTTPException 404 si fichier introuvable, 409 si new_filename existe déjà.
    """
    # 1. Localiser le PDF (en_attente/ puis traites/)
    en_attente = config.JUSTIFICATIFS_DIR / old_filename
    traites = config.JUSTIFICATIFS_TRAITES_DIR / old_filename
    
    if en_attente.exists():
        pdf_path = en_attente
        location = "en_attente"
    elif traites.exists():
        pdf_path = traites
        location = "traites"
    else:
        raise HTTPException(404, f"Justificatif {old_filename} introuvable")
    
    target_dir = pdf_path.parent
    
    # 2. Vérifier collision
    final_filename = new_filename
    if (target_dir / final_filename).exists() and final_filename != old_filename:
        raise HTTPException(409, f"Le fichier {final_filename} existe déjà")
    
    if final_filename == old_filename:
        return {"old": old_filename, "new": old_filename, "location": location}
    
    # 3. Renommer PDF
    new_pdf_path = target_dir / final_filename
    pdf_path.rename(new_pdf_path)
    
    # 4. Renommer .ocr.json
    old_ocr = pdf_path.with_suffix(".ocr.json")
    if old_ocr.exists():
        new_ocr = new_pdf_path.with_suffix(".ocr.json")
        # Mettre à jour le contenu du .ocr.json
        import json
        ocr_data = json.loads(old_ocr.read_text(encoding="utf-8"))
        ocr_data["renamed_from"] = old_filename
        ocr_data["original_filename"] = ocr_data.get("original_filename", old_filename)
        new_ocr.write_text(json.dumps(ocr_data, ensure_ascii=False, indent=2), encoding="utf-8")
        if old_ocr != new_ocr:
            old_ocr.unlink()
    
    # 5. Mettre à jour les associations dans les opérations
    _update_operation_references(old_filename, final_filename)
    
    # 6. Mettre à jour les metadata GED
    _update_ged_metadata_reference(old_filename, final_filename)
    
    return {"old": old_filename, "new": final_filename, "location": location}


def auto_rename_from_ocr(filename: str, ocr_data: dict) -> Optional[str]:
    """
    Tente un auto-rename basé sur les données OCR.
    Retourne le nouveau filename si renommé, None sinon.
    Ne renomme PAS si le fichier suit déjà la convention (3 segments valides).
    """
    from backend.services.ocr_service import _parse_filename_convention
    
    # Si le fichier est déjà nommé selon la convention, ne pas re-renommer
    existing_parsed = _parse_filename_convention(filename)
    if existing_parsed and all(existing_parsed.get(k) for k in ("supplier", "date", "amount")):
        return None
    
    supplier = ocr_data.get("supplier")
    best_date = ocr_data.get("best_date")
    best_amount = ocr_data.get("best_amount")
    
    new_name = build_convention_filename(supplier, best_date, best_amount)
    if not new_name or new_name == filename:
        return None
    
    # Dédupliquer
    # Déterminer le répertoire
    en_attente = config.JUSTIFICATIFS_DIR / filename
    traites = config.JUSTIFICATIFS_TRAITES_DIR / filename
    target_dir = en_attente.parent if en_attente.exists() else traites.parent
    
    final_name = deduplicate_filename(target_dir, new_name)
    
    try:
        result = rename_justificatif(filename, final_name)
        return result["new"]
    except Exception:
        # Silencieux — le rename est best-effort
        return None


def _update_operation_references(old_filename: str, new_filename: str):
    """
    Parcourt tous les fichiers d'opérations et remplace les références
    justificatif_file == old_filename par new_filename.
    Gère aussi les ventilation lines.
    """
    import json
    ops_dir = config.IMPORTS_OPERATIONS_DIR
    for ops_file in ops_dir.glob("operations_*.json"):
        data = json.loads(ops_file.read_text(encoding="utf-8"))
        modified = False
        for op in data:
            if op.get("justificatif_file") == old_filename:
                op["justificatif_file"] = new_filename
                modified = True
            for vl in op.get("ventilation", []):
                if vl.get("justificatif_file") == old_filename:
                    vl["justificatif_file"] = new_filename
                    modified = True
        if modified:
            ops_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _update_ged_metadata_reference(old_filename: str, new_filename: str):
    """
    Met à jour ged_metadata.json si le justificatif y est référencé.
    """
    import json
    ged_path = Path(config.GED_DIR) / "ged_metadata.json"
    if not ged_path.exists():
        return
    metadata = json.loads(ged_path.read_text(encoding="utf-8"))
    if old_filename in metadata:
        metadata[new_filename] = metadata.pop(old_filename)
        metadata[new_filename]["filename"] = new_filename
        if "renamed_from" not in metadata[new_filename]:
            metadata[new_filename]["renamed_from"] = old_filename
        ged_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
```

---

### Étape 3 — Intégration sandbox + batch upload

**Fichier : `backend/services/sandbox_service.py`** — dans `_process_file()`, après l'appel OCR et avant l'envoi SSE :

```python
# Après OCR réussi
ocr_data = ocr_service.extract_or_cached(pdf_path)

# Auto-rename basé sur OCR
new_filename = justificatif_service.auto_rename_from_ocr(pdf_path.name, ocr_data)
final_filename = new_filename or pdf_path.name

# SSE event avec le filename final
event_data = {
    "filename": final_filename,
    "original_filename": pdf_path.name if new_filename else None,
    "status": "processed",
    "auto_renamed": new_filename is not None,
    "timestamp": datetime.now().isoformat()
}
```

**Fichier : `backend/routers/ocr.py`** — dans `batch_upload()`, après OCR de chaque fichier, appeler `auto_rename_from_ocr()` et retourner le `final_filename` dans la réponse.

---

### Étape 4 — Endpoint rename

**Fichier : `backend/routers/justificatifs.py`** (ajouter)

```python
from backend.services.naming_service import build_convention_filename

class RenameRequest(BaseModel):
    new_filename: str  # Nom complet avec .pdf

@router.post("/{filename}/rename")
async def rename_justificatif_endpoint(filename: str, body: RenameRequest):
    """
    Renomme un justificatif. Met à jour le PDF, le .ocr.json,
    les associations opérations, et les metadata GED.
    """
    # Validation : doit finir par .pdf
    if not body.new_filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Le nom doit se terminer par .pdf")
    
    # Validation : pas de caractères interdits
    if re.search(r'[<>:"/\\|?*]', body.new_filename):
        raise HTTPException(400, "Caractères interdits dans le nom de fichier")
    
    result = justificatif_service.rename_justificatif(filename, body.new_filename)
    return result
```

---

### Étape 5 — Frontend : hook + composant

**Fichier : `frontend/src/hooks/useApi.ts`** (ajouter)

```typescript
// Hook rename
export function useRenameJustificatif() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ filename, newFilename }: { filename: string; newFilename: string }) => {
      const res = await fetch(`${API}/justificatifs/${encodeURIComponent(filename)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_filename: newFilename }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Erreur rename" }));
        throw new Error(err.detail);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justificatifs"] });
      queryClient.invalidateQueries({ queryKey: ["ocr"] });
      queryClient.invalidateQueries({ queryKey: ["ged"] });
    },
  });
}
```

**Fichier : `frontend/src/components/justificatifs/FilenameEditor.tsx`** (nouveau)

```typescript
interface FilenameEditorProps {
  filename: string;
  /** Affiché si le fichier a été auto-renommé */
  originalFilename?: string | null;
  onRenamed?: (newFilename: string) => void;
}
```

Comportement du composant :
- **Affichage normal** : nom du fichier cliquable (icône Pencil Lucide à droite, discret)
- **Clic** → passe en mode édition : input text pré-rempli avec le stem (sans .pdf), focus auto, sélection du texte
- **Validation** : Enter ou blur → appel `useRenameJustificatif`, toast succès/erreur, retour mode affichage
- **Annulation** : Escape → retour mode affichage sans appel
- **Badge** : si `originalFilename` est défini, afficher un petit badge "auto" (icône Wand2 Lucide, tooltip "Renommé automatiquement depuis {originalFilename}")
- **Pas de .pdf dans l'input** : l'extension est ajoutée automatiquement côté composant

Styling : input avec `bg-transparent border-b border-accent`, même font que le texte, transition fluide.

---

### Étape 6 — Intégration du FilenameEditor

**1. Historique OCR** (`OcrHistoryTab` ou équivalent)
- Remplacer l'affichage statique du filename par `<FilenameEditor filename={item.filename} originalFilename={item.original_filename} />`

**2. Drawer justificatif** (dans le drawer de la page Justificatifs)
- Sous le preview PDF, au-dessus de l'OcrDataEditor, afficher le `<FilenameEditor />`

**3. Toast sandbox** (optionnel V2)
- Quand `auto_renamed: true` dans l'event SSE, le toast affiche "Renommé : {new} (était : {original})" avec un lien "Modifier" qui ouvre le drawer

---

### Étape 7 — Mise à jour SSE hook

**Fichier : `frontend/src/hooks/useSandbox.ts`**

Mettre à jour le type de l'event pour inclure `auto_renamed` et `original_filename`. Le toast conditionne son message :
- Si `auto_renamed` : "📄 {filename} traité et renommé" (vert)
- Sinon : "📄 {filename} traité" (vert, comme avant)

---

## Points d'attention

- **Idempotence** : `auto_rename_from_ocr()` ne re-renomme pas un fichier déjà conforme à la convention (détecté par `_parse_filename_convention`)
- **Traçabilité** : `original_filename` et `renamed_from` conservés dans le `.ocr.json`
- **Associations** : `_update_operation_references()` met à jour TOUTES les ops qui pointent vers l'ancien nom
- **Concurrence sandbox** : le rename se fait après le move vers en_attente/ et après l'OCR, donc pas de conflit avec le watchdog
- **Batch upload** : même logique auto-rename, le response inclut `final_filename` + `auto_renamed: bool`

## Vérification

- [ ] Déposer un PDF nommé `scan001.pdf` dans sandbox → vérifie qu'il est renommé en `fournisseur_YYYYMMDD_montant,XX.pdf`
- [ ] Déposer un JPG → converti en PDF → renommé
- [ ] Déposer un fichier déjà nommé selon la convention → PAS re-renommé
- [ ] OCR avec supplier=null → renommé en `inconnu_YYYYMMDD_montant.pdf`
- [ ] OCR avec date=null → PAS renommé (garde le nom original)
- [ ] Doublon de nom → suffixe `_2` ajouté
- [ ] Frontend : clic sur le nom → édition inline → Enter → rename effectif
- [ ] Frontend : Escape annule l'édition
- [ ] Frontend : badge "auto" visible sur les fichiers auto-renommés
- [ ] Associations opérations mises à jour après rename
- [ ] GED metadata mise à jour après rename
- [ ] `tsc --noEmit` passe
- [ ] Aucun `any` TypeScript
