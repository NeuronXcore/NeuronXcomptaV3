# Prompt Claude Code — Annotation immobilisation + visualisation justificatif

> **Objet** : sur la page Amortissements, rendre la `designation` éditable inline dans le registre + exposer le justificatif rattaché à l'immobilisation (via transitivité op) directement depuis la table et le drawer édition, avec preview agrandissable et ouverture native macOS.
>
> **Lecture préalable obligatoire** : `CLAUDE.md` racine du projet.

---

## 1. Contexte & motivation

Aujourd'hui sur la page Amortissements (onglet Registre) :
- La `designation` est souvent remplie avec le libellé bancaire brut (ex `PRLVSEPAPAYPALDU0418/EPSON—579,00`) → illisible.
- Le justificatif rattaché à l'opération source de l'immo n'est pas accessible depuis le registre. Il faut naviguer vers l'éditeur pour le retrouver.
- En mode **édition** d'une immo dans `ImmobilisationDrawer`, la section « op source + justif » qui existe en mode **candidate** n'est pas affichée — perte d'info.

Cette feature corrige les deux trous.

---

## 2. Principes architecturaux (rappels CLAUDE.md)

- **Pas de nouvelle relation directe `Immobilisation.justificatif_filename`**. Le justif vit sur l'opération (`Operation."Lien justificatif"`). L'immobilisation le voit **par transitivité** via `Operation.immobilisation_id`. Single source of truth préservée → cascades delete/dissociate déjà stables.
- **Reuse before building** : on réutilise `PdfThumbnail`, `PreviewSubDrawer`, `JustifPreviewLightbox` (à extraire), `ManualAssociationDrawer` (mode targeted), `JustificatifPreviewBlock` (déjà utilisé en mode candidate).
- `from __future__ import annotations` + `Optional[X]` partout côté Python ; pas de `any` côté TS ; Lucide uniquement ; variables CSS pour toutes les couleurs.
- TanStack Query : invalidation multi-clés sur chaque mutation. `refresh_alertes_fichier()` non requis ici (on ne touche pas aux ops).

---

## 3. Périmètre

| # | Item | Composant impacté |
|---|------|---|
| A | Édition inline de `designation` dans `RegistreTab` (hover crayon, double-clic texte, Enter/Esc) | `RegistreTab.tsx` |
| B | Nouvelle colonne paperclip dans la table → ouvre directement `PreviewSubDrawer` standalone | `RegistreTab.tsx` |
| C | Section « Opération source & justificatif » dans `ImmobilisationDrawer` en mode édition (parité avec mode candidate) | `ImmobilisationDrawer.tsx` |
| D | Chaîne de visualisation : thumbnail/paperclip → `PreviewSubDrawer` 700px → bouton « Voir en plein écran » → `JustifPreviewLightbox` 90vw × 90vh → bouton « Ouvrir dans Aperçu » (`target="_blank"`) | `PreviewSubDrawer.tsx`, nouveau shared `JustifPreviewLightbox.tsx` |
| E | Extraction `JustifPreviewLightbox` (actuellement interne à `PendingScansWidget`) vers `components/shared/` pour réutilisation | refactor + recâblage `PendingScansWidget.tsx` |
| F | Helper visuel sous le champ designation du drawer (lightbulb + texte d'incitation) | `ImmobilisationDrawer.tsx` |

---

## 4. Implémentation (ordre strict)

### 4.1 Backend — modèles Pydantic

`backend/models/amortissement.py` :

```python
class ImmobilisationJustifMeta(BaseModel):
    filename: str
    supplier: Optional[str] = None
    size_bytes: Optional[int] = None

class ImmobilisationSource(BaseModel):
    operation_file: str
    operation_index: int
    libelle: str
    date: str
    debit: float
    credit: float
    categorie: str
    sous_categorie: str
    justificatif: Optional[ImmobilisationJustifMeta] = None
```

Étendre **le sérialiseur du registre** (méthode qui produit la liste retournée par `GET /amortissements/`) avec deux champs additionnels :
- `has_justif: bool`
- `justif_filename: Optional[str]`

Ces champs sont consommés par la colonne paperclip (étape 4.7B) — évite le N+1 côté frontend.

### 4.2 Backend — service `amortissement_service`

Dans `backend/services/amortissement_service.py`, ajouter un **index inversé** `immobilisation_id → (op_file, op_index)` construit lazy + invalidé sur mutations d'ops.

```python
_immo_op_index: Optional[dict[str, tuple[str, int]]] = None
_immo_op_index_lock = threading.Lock()

def _build_immo_op_index() -> dict[str, tuple[str, int]]:
    """Scan tous les fichiers d'opérations, construit la map immo_id → (file, idx)."""
    idx: dict[str, tuple[str, int]] = {}
    for filename in operation_service.iter_operation_files():
        ops = operation_service.load_operations(filename)
        for i, op in enumerate(ops):
            immo_id = op.get("immobilisation_id")
            if immo_id:
                idx[immo_id] = (filename, i)
    return idx

def invalidate_immo_op_index() -> None:
    """À appeler depuis tout endroit qui modifie immobilisation_id sur une op."""
    global _immo_op_index
    with _immo_op_index_lock:
        _immo_op_index = None

def _get_immo_op_index() -> dict[str, tuple[str, int]]:
    global _immo_op_index
    with _immo_op_index_lock:
        if _immo_op_index is None:
            _immo_op_index = _build_immo_op_index()
        return _immo_op_index
```

Câbler `invalidate_immo_op_index()` dans :
- `link_operation_to_immobilisation()` (déjà existant)
- `delete_immobilisation()` (déjà existant — la cascade fait `op.pop("immobilisation_id")`)
- Tout endpoint d'édition/save d'opération qui pourrait toucher `immobilisation_id` (à auditer via grep).

Puis :

```python
def get_linked_op_with_justif(immo_id: str) -> Optional[dict]:
    """Retourne {operation_file, operation_index, libelle, date, debit, credit,
    categorie, sous_categorie, justificatif: {...} | None} ou None si pas d'op rattachée."""
    pos = _get_immo_op_index().get(immo_id)
    if pos is None:
        return None
    filename, idx = pos
    ops = operation_service.load_operations(filename)
    if idx >= len(ops):
        invalidate_immo_op_index()  # index obsolète
        return None
    op = ops[idx]
    if op.get("immobilisation_id") != immo_id:
        invalidate_immo_op_index()
        return None

    justif_filename = (op.get("Lien justificatif") or "").strip()
    justif_meta: Optional[dict] = None
    if justif_filename and not justif_filename.startswith("reports/"):
        base = Path(justif_filename).name
        ocr = justificatif_service.load_ocr_data(base)  # adapter au nom exact
        supplier = None
        if ocr:
            supplier = (ocr.get("extracted_data") or {}).get("supplier")
        size_bytes = justificatif_service.get_size_bytes(base)
        justif_meta = {"filename": base, "supplier": supplier, "size_bytes": size_bytes}

    return {
        "operation_file": filename,
        "operation_index": idx,
        "libelle": op.get("Libellé", ""),
        "date": op.get("Date", ""),
        "debit": float(op.get("Débit") or 0),
        "credit": float(op.get("Crédit") or 0),
        "categorie": op.get("Catégorie", ""),
        "sous_categorie": op.get("Sous-catégorie", ""),
        "justificatif": justif_meta,
    }
```

Adapter aux noms exacts des helpers existants (`iter_operation_files`, `load_operations`, `load_ocr_data`, `get_size_bytes`). Si `justificatif_service.get_size_bytes(base)` n'existe pas, utiliser `Path(...).stat().st_size` avec gestion `FileNotFoundError → None`.

Le sérialiseur `list_immobilisations()` (étape 4.1) appelle `_get_immo_op_index()` une fois pour récupérer en bulk les `op_file/op_index` puis lit pour chaque op concernée le `Lien justificatif` → remplit `has_justif` + `justif_filename`.

### 4.3 Backend — router

Dans `backend/routers/amortissements.py`, **avant** la route `GET /{immo_id}` (ordre FastAPI critique — sinon `/{immo_id}/source` est capturé par la dynamique) :

```python
@router.get("/{immo_id}/source", response_model=Optional[ImmobilisationSource])
def get_immobilisation_source(immo_id: str):
    if not amortissement_service.get_immobilisation(immo_id):
        raise HTTPException(404, "Immobilisation introuvable")
    return amortissement_service.get_linked_op_with_justif(immo_id)
```

### 4.4 Frontend — types

`frontend/src/types.ts` (ou fichier amortissements dédié) :

```ts
export interface ImmobilisationJustifMeta {
  filename: string;
  supplier: string | null;
  size_bytes: number | null;
}

export interface ImmobilisationSource {
  operation_file: string;
  operation_index: number;
  libelle: string;
  date: string;
  debit: number;
  credit: number;
  categorie: string;
  sous_categorie: string;
  justificatif: ImmobilisationJustifMeta | null;
}
```

Étendre l'interface `Immobilisation` avec :
```ts
has_justif?: boolean;
justif_filename?: string | null;
```

### 4.5 Frontend — hook

Dans `frontend/src/hooks/useAmortissements.ts` :

```ts
export function useImmobilisationSource(immoId: string | null | undefined) {
  return useQuery<ImmobilisationSource | null>({
    queryKey: ["amortissements", "source", immoId],
    queryFn: () =>
      api.get<ImmobilisationSource | null>(`/amortissements/${immoId}/source`),
    enabled: !!immoId,
    staleTime: 30_000,
  });
}
```

**Mutations à étendre** (rajouter la queryKey `["amortissements", "source"]` aux invalidations existantes) :
- `useUpdateImmobilisation`
- `useDeleteImmobilisation`
- `useCreateImmobilisation`
- Toute mutation côté ops qui touche `immobilisation_id` (rapprochement, dissociation justif…) doit invalider `["amortissements"]` + `["amortissements", "source"]`.

### 4.6 Extraction `JustifPreviewLightbox`

Déplacer le composant `JustifPreviewLightbox` (actuellement interne à `frontend/src/components/pipeline/PendingScansWidget.tsx`) vers :

```
frontend/src/components/shared/JustifPreviewLightbox.tsx
```

API publique :

```ts
interface JustifPreviewLightboxProps {
  filename: string | null;       // null = closed
  onClose: () => void;
  onOpenExternal?: () => void;   // bouton « Ouvrir dans Aperçu » optionnel
}
```

Comportement : modal plein écran (z-60, backdrop `bg-black/80 backdrop-blur-sm`, clic = close), card centrale `90vw × 90vh max 1100px`, header avec icône doc + filename + bouton External Link + bouton X, contenu via `<object type="application/pdf" data="/api/justificatifs/${filename}/file">` pleine taille, Esc handler.

Recâbler `PendingScansWidget` pour consommer le composant partagé. **Aucune régression visuelle attendue.**

### 4.7 `RegistreTab` — édition inline + colonne paperclip

#### A. Édition inline `designation`

État local : `editingId: string | null`, `editValue: string`.

Helper d'heuristique (à déclarer en haut du fichier ou dans `lib/utils.ts`) :

```ts
const RAW_LIBELLE_PREFIXES = /^(PRLV|CB |VIR|SEPA|RETRAIT|CHQ|PAIEMENT)/i;

export function isLibelleBrut(designation: string | null | undefined): boolean {
  if (!designation) return true;
  const s = designation.trim();
  return s.length === 0 || RAW_LIBELLE_PREFIXES.test(s) || s.length > 80;
}
```

Cellule designation :

```tsx
<div className="group flex items-center gap-2 min-w-[280px]">
  <div className="w-[30px] h-[30px] rounded-md bg-primary-bg text-primary-light grid place-items-center flex-shrink-0">
    <Package size={15} />
  </div>
  <div className="flex-1 min-w-0">
    {editingId === immo.id ? (
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => commitEdit(immo.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitEdit(immo.id); }
          if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
        }}
        placeholder="ex : Ordinateur portable MacBook Pro M3"
        className="w-full bg-bg border border-primary rounded-md px-2.5 py-1.5 text-[13px] outline-none ring-2 ring-primary/20"
      />
    ) : (
      <>
        <div
          onDoubleClick={(e) => { e.stopPropagation(); startEdit(immo); }}
          className={cn(
            "font-medium truncate",
            isLibelleBrut(immo.designation) && "italic text-text-dim font-normal"
          )}
        >
          {immo.designation || immo.libelle_brut_fallback || "Libellé non renseigné"}
        </div>
        {/* meta line: poste · durée · badge reprise */}
      </>
    )}
  </div>
  {editingId !== immo.id && (
    <button
      onClick={(e) => { e.stopPropagation(); startEdit(immo); }}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-primary-light"
      aria-label="Annoter la désignation"
    >
      <Pencil size={14} />
    </button>
  )}
</div>
```

`commitEdit` :

```ts
const commitEdit = async (immoId: string) => {
  const value = editValue.trim();
  setEditingId(null);
  // Skip if no change
  const current = immobilisations?.find(i => i.id === immoId)?.designation ?? "";
  if (value === current) return;
  await updateMutation.mutateAsync({ immo_id: immoId, designation: value });
  toast.success(value
    ? `Désignation mise à jour : « ${value} »`
    : "Désignation effacée");
};
```

#### B. Colonne paperclip

Insérée **avant** la dernière colonne (Actions s'il y en a une, sinon en dernier). Header : `<th className="w-[60px] text-center">Justif.</th>`.

Cellule :

```tsx
<td className="text-center">
  {immo.has_justif ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        openSubDrawerStandalone(immo.justif_filename!);
      }}
      className="w-8 h-8 rounded-md bg-success/10 text-success grid place-items-center hover:bg-success/20 hover:scale-105 transition-all"
      aria-label="Aperçu du justificatif"
      title={immo.justif_filename ?? ""}
    >
      <Paperclip size={16} />
    </button>
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toast("Aucun justificatif associé à cette immobilisation");
      }}
      className="w-8 h-8 rounded-md text-text-dim grid place-items-center hover:bg-surface-hover relative"
      aria-label="Pas de justificatif"
      title="Aucun justificatif"
    >
      <Paperclip size={16} />
      <span className="absolute top-1/2 left-1 right-1 h-[1.5px] bg-text-dim rotate-[-25deg] rounded" />
    </button>
  )}
</td>
```

`openSubDrawerStandalone` ouvre `PreviewSubDrawer` en mode standalone (`right: 0`, sans drawer principal derrière). Voir étape 4.8 pour la prop ajoutée au composant.

### 4.8 `PreviewSubDrawer` — extension props

Le composant `PreviewSubDrawer` (`components/ocr/PreviewSubDrawer.tsx`) actuel s'ancre `right-[mainDrawerWidth]px` quand un drawer principal est ouvert. **Ajouter** une prop `standalone?: boolean` (default `false`) qui :
- Ancre `right-0` au lieu de `right-[680px]`.
- Affiche un backdrop `bg-black/55 backdrop-blur-sm` en plus (qu'on n'a pas en mode `with-main` puisque le drawer principal a déjà le sien).
- Active le bouton « Voir en plein écran » (toujours visible) qui appelle un nouveau prop `onOpenLightbox?: () => void`.

Header buttons (toujours présents) :
- `<Maximize2 />` « Voir en plein écran » → `onOpenLightbox()`
- `<ExternalLink />` « Ouvrir dans Aperçu » → `window.open('/api/justificatifs/${filename}/file', '_blank')`
- `<X />` Fermer

### 4.9 `ImmobilisationDrawer` — section source en mode édition

Dans `ImmobilisationDrawer.tsx`, la condition d'affichage de la section source doit passer de :

```ts
{candidate !== null && (...)}
```

à :

```ts
{(candidate !== null || (isEdit && immobilisation?.id)) && (...)}
```

En mode édition, charger `useImmobilisationSource(immobilisation?.id)` :

```ts
const { data: source } = useImmobilisationSource(immobilisation?.id);
```

Rendu :
- Si `isEdit && !source` → bandeau info bleu : « Aucune opération source rattachée (immobilisation créée manuellement ou en reprise) ».
- Si `source` non null → carte op (libellé / date / catégorie / montant) + bouton « Voir dans l'éditeur » → `navigate('/editor?file=${source.operation_file}&highlight=${source.operation_index}&from=amortissements')`.
- Si `source.justificatif` non null → `<JustificatifPreviewBlock />` avec :
  - `PdfThumbnail justificatifFilename={source.justificatif.filename}` 80×100 cliquable → `openSubDrawerWithMain(filename)` (ancré `right: 650px`).
  - Filename + supplier + size formatée.
  - Boutons mini : « Voir en grand » (= clic thumbnail) / « Aperçu » (`target="_blank"`) / « Dissocier » → `useDissociateJustificatif.mutate({operation_file, operation_index})` + invalidation `['amortissements', 'source', immo.id]`.
- Si `source` non null mais `source.justificatif` null → encadré ambre : « Aucun justificatif associé » + bouton « Associer » → ouvre `ManualAssociationDrawer` mode targeted avec :
  ```ts
  targetedOps: [{
    filename: source.operation_file,
    index: source.operation_index,
    libelle: source.libelle,
    date: source.date,
    montant: Math.max(source.debit, source.credit),
    categorie: source.categorie,
    sousCategorie: source.sous_categorie,
  }]
  ```

Le `PreviewSubDrawer` ouvert depuis le drawer édition reçoit le prop `onOpenLightbox` qui set un state local `lightboxFilename` → render `<JustifPreviewLightbox />` (étape 4.6).

### 4.10 Helper visuel sous le champ designation du drawer

Sous le `<input>` de désignation du formulaire (mode édition + mode candidate) :

```tsx
<div className="text-xs text-primary-light flex items-start gap-1.5 mt-1.5">
  <Lightbulb size={12} className="mt-0.5 flex-shrink-0" />
  <span>
    Donne un nom court et descriptif (ex : « Ordinateur », « Fauteuil bureau »).
    {isLibelleBrut(immobilisation?.designation) && (
      <> Cette immo a été créée depuis le libellé bancaire — à renommer.</>
    )}
  </span>
</div>
```

### 4.11 Esc handler (gestion Z-stack)

Dans `ImmobilisationDrawer` + parent qui monte le `JustifPreviewLightbox` : Esc ferme **dans cet ordre** :
1. Si lightbox ouverte → ferme lightbox uniquement (`stopPropagation`).
2. Sinon si sub-drawer ouvert → ferme sub-drawer uniquement (`stopPropagation`).
3. Sinon ferme drawer principal.

Pattern `stopPropagation` en mode capture déjà documenté pour `PreviewSubDrawer` dans CLAUDE.md.

---

## 5. Vérification (à dérouler systématiquement)

1. **Édition inline** : hover sur une ligne → crayon visible. Clic → input autofocus + texte sélectionné. Tape « Test ordinateur ». Enter → toast success + cellule mise à jour. F5 → la valeur persiste.
2. **Escape annule** : startEdit + tape « xxx » + Escape → revient à la valeur précédente, **0 appel API** (vérifier Network).
3. **Double-clic** sur le texte de désignation déclenche aussi l'édition.
4. **Heuristique placeholder** : créer une immo avec `designation = "PRLVSEPATEST"` → s'affiche en italique gris (`text-text-dim`).
5. **Colonne paperclip — has_justif** : ligne avec justif → bouton vert, click → `PreviewSubDrawer` standalone à droite avec backdrop, PDF visible. Esc ferme.
6. **Colonne paperclip — pas de justif** : paperclip muted barré (trait diagonal CSS), click → toast info, drawer ne s'ouvre pas.
7. **Click ligne hors crayon/paperclip** → drawer principal s'ouvre. Section « Opération source & justificatif » visible avec carte op + thumbnail (si justif présent).
8. **Bouton « Voir dans l'éditeur »** dans la carte op → navigation vers `/editor?file=...&highlight=...&from=amortissements`. Breadcrumb « ← Retour à Amortissements » visible.
9. **Click thumbnail dans drawer** → sub-drawer s'ouvre à `right: 650px` (les deux drawers visibles côte à côte).
10. **« Voir en plein écran »** dans sub-drawer → `JustifPreviewLightbox` 90vw × 90vh. PDF lisible.
11. **« Ouvrir dans Aperçu »** (testé depuis sub-drawer ET lightbox ET drawer édition) → nouvel onglet avec `/api/justificatifs/{filename}/file`. Sur macOS, le navigateur permet « Ouvrir avec → Aperçu ».
12. **Immo en reprise sans op** : drawer édition → bandeau info bleu « Aucune opération source rattachée ». **Pas** de bloc justif. Pas de crash.
13. **Immo avec op mais sans justif** : drawer édition → carte op visible + encadré ambre « Aucun justificatif associé » + bouton « Associer » qui ouvre `ManualAssociationDrawer` targeted.
14. **Régression mode candidate** : créer une immo depuis l'onglet Candidates → la section source apparaît toujours, les boutons « Voir en grand » fonctionnent toujours.
15. **Régression `PendingScansWidget`** : le lightbox extrait fonctionne toujours dans le widget Pipeline (pas de double-rendu, pas de crash).
16. **Z-stack Esc** : drawer + sub-drawer + lightbox tous ouverts → Esc ferme la lightbox seule (puis sub-drawer, puis drawer).
17. **Backdrop click** : sur sub-drawer standalone → ferme le sub-drawer. Sur sub-drawer with-main → ferme les deux ? Ou que le sub ? **Choix** : ferme uniquement le sub-drawer (cohérent avec le pattern existant en mode candidate).
18. **TypeScript** : `npx tsc -p tsconfig.app.json --noEmit` → 0 erreur.
19. **Backend** : route `/source` matche **avant** `/{immo_id}` dans le router (vérifier l'ordre des décorateurs).
20. **Index inversé invalidé** :
    - Créer une immo depuis Candidates (qui pose `immobilisation_id` sur l'op) → `has_justif` correct dans le registre **immédiatement** (pas après reload).
    - Supprimer une immo (cascade qui retire `immobilisation_id`) → `has_justif` reflète `false` immédiatement sur les autres immos affectées (logiquement aucune, mais la cohérence du cache reste vraie).
    - Dissocier le justif depuis le drawer édition → le paperclip de la ligne dans le registre passe à muted barré sans reload.
21. **CLAUDE.md** : ajouter une section « Annotation immobilisation + visualisation justif » avec un récap de la feature et un pointeur vers les fichiers clés.

---

## 6. Hors scope (évolutions futures)

- Pas de bulk-edit des désignations (renommer N immos en une action).
- Pas de relation directe `Immobilisation.justificatif_filename` — la transitivité op reste l'unique source de vérité.
- Pas d'édition inline du **poste comptable** depuis la table (uniquement via drawer).
- Pas de détection auto / suggestion de désignation propre via un LLM local (hors scope V1 ; éventuellement plus tard via Llama 3.3).
- Pas de drag-and-drop de justif depuis le bureau directement sur une ligne de registre.

---

## 7. Fichiers attendus modifiés / créés

### Créés
- `frontend/src/components/shared/JustifPreviewLightbox.tsx` (extrait depuis PendingScansWidget)

### Modifiés (backend)
- `backend/models/amortissement.py` — modèles `ImmobilisationSource`, `ImmobilisationJustifMeta` ; champs `has_justif` + `justif_filename` sur l'item liste
- `backend/services/amortissement_service.py` — index inversé + `get_linked_op_with_justif` + helper liste enrichie
- `backend/routers/amortissements.py` — route `GET /{immo_id}/source` (avant `/{immo_id}`)
- Tout endpoint qui modifie `Operation.immobilisation_id` doit appeler `invalidate_immo_op_index()` (audit grep)

### Modifiés (frontend)
- `frontend/src/types.ts` — types `ImmobilisationSource`, `ImmobilisationJustifMeta`, extension `Immobilisation`
- `frontend/src/hooks/useAmortissements.ts` — `useImmobilisationSource` + invalidations multi-clés
- `frontend/src/lib/utils.ts` — helper `isLibelleBrut`
- `frontend/src/components/amortissements/RegistreTab.tsx` — édition inline + colonne paperclip
- `frontend/src/components/amortissements/ImmobilisationDrawer.tsx` — section source en mode édition + helper lightbulb
- `frontend/src/components/ocr/PreviewSubDrawer.tsx` — props `standalone` + `onOpenLightbox`
- `frontend/src/components/pipeline/PendingScansWidget.tsx` — recâblage sur le lightbox partagé

### Modifiés (docs)
- `CLAUDE.md` — section Amortissements enrichie

---

**Fin du prompt.** Lire `CLAUDE.md` puis appliquer dans l'ordre 4.1 → 4.10 → vérification 5.x.
