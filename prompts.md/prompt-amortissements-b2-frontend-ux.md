# Prompt B2 — Amortissements : frontend UX (onglet Dotation + badges + navigation)

## Contexte

Les Prompts A1/A2/B1 ont livré :
- A1 : backend fiscal (BNC centralisé, ligne virtuelle, exclusions)
- A2 : frontend fiscal (sidebar sync, `DotationsVirtualDrawer`, config simplifiée)
- B1 : backend écritures (OD + PDF + GED + task auto + export ZIP)

Ce prompt finalise l'UX utilisateur :

1. **Onglet Dotation** dans `AmortissementsPage` (5ᵉ onglet, pattern `BlanchissageTab`)
2. **Badges `Immo` et `Dotation`** dans EditorPage / JustificatifsPage / AlertesPage
3. **Filtre `Type d'opération` étendu** (4 pages)
4. **`ImmobilisationDrawer` enrichi** : section op source + sous-drawer justif + préfill OCR
5. **Navigation bidirectionnelle complète** (URL params + boutons + breadcrumb)

## Dépendances

**Prompts A1 + A2 + B1 exécutés et commités.** Nécessaires :
- Endpoints B1 : `/generer-dotation`, `/supprimer-dotation`, `/regenerer-pdf-dotation`, `/candidate-detail`, `/dotation-genere`
- Endpoints A1 : `/virtual-detail`, `/dotation-ref/{year}`
- `DotationsVirtualDrawer` d'A2 opérationnel

## Fichiers touchés

### Nouveaux composants
- `frontend/src/components/amortissements/DotationTab.tsx`
- `frontend/src/components/shared/ImmoBadge.tsx`
- `frontend/src/components/shared/DotationBadge.tsx`

### Composants existants à modifier
- `frontend/src/pages/AmortissementsPage.tsx` — 5ᵉ onglet + URL param `?tab=dotation`
- `frontend/src/components/amortissements/ImmobilisationDrawer.tsx` — section op source + préfill + sous-drawer justif
- `frontend/src/components/analytics/DotationsVirtualDrawer.tsx` — cartes cliquables + bouton OD footer
- `frontend/src/pages/EditorPage.tsx` — badges + filtre Type d'op + breadcrumb
- `frontend/src/pages/JustificatifsPage.tsx` — badges + filtre Type d'op
- `frontend/src/pages/AlertesPage.tsx` — badges + filtre Type d'op
- `frontend/src/components/analytics/RepartitionParTypeCard.tsx` — 2 types en plus
- `frontend/src/components/analytics/ComptaAnalytiquePage.tsx` — auto-open drawer via URL param

### Hooks et types
- `frontend/src/hooks/useAmortissements.ts` — 5 nouveaux hooks
- `frontend/src/types/index.ts` — types `CandidateDetail`, `DotationGenere`, `OperationType` étendu

---

## Étapes ordonnées

### Étape 1 — Types + hooks

**`frontend/src/types/index.ts`** :

```ts
export interface OcrPrefill {
  designation: string;
  date_acquisition: string;
  base_amortissable: number;
}

export interface CandidateDetail {
  operation: Operation;
  justificatif: { filename: string; ocr_data: Record<string, any> } | null;
  ocr_prefill: OcrPrefill;
}

export interface DotationGenere {
  year: number;
  pdf_filename: string | null;
  ged_doc_id: string | null;
  montant: number;
  filename: string;
  index: number;
}

export type OperationType = 'all' | 'bancaire' | 'note_de_frais' | 'immobilisation' | 'dotation';
```

**`frontend/src/hooks/useAmortissements.ts`** :

```ts
export function useGenererDotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: number) =>
      api.post(`/amortissements/generer-dotation?year=${year}`),
    onSuccess: (_, year) => {
      qc.invalidateQueries({ queryKey: ['amortissements'] });
      qc.invalidateQueries({ queryKey: ['operations'] });
      qc.invalidateQueries({ queryKey: ['ged'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useSupprimerDotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: number) =>
      api.delete(`/amortissements/supprimer-dotation?year=${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] });
      qc.invalidateQueries({ queryKey: ['operations'] });
      qc.invalidateQueries({ queryKey: ['ged'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useRegenererPdfDotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: number) =>
      api.post(`/amortissements/regenerer-pdf-dotation?year=${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged'] });
    },
  });
}

export function useDotationGenere(year: number) {
  return useQuery<DotationGenere | null>({
    queryKey: ['amortissements', 'dotation-genere', year],
    queryFn: () => api.get(`/amortissements/dotation-genere?year=${year}`),
  });
}

export function useCandidateDetail(
  filename: string | null,
  index: number | null,
) {
  return useQuery<CandidateDetail>({
    queryKey: ['amortissements', 'candidate-detail', filename, index],
    queryFn: () =>
      api.get(`/amortissements/candidate-detail?filename=${filename}&index=${index}`),
    enabled: !!filename && index !== null,
  });
}
```

### Étape 2 — `DotationTab` (pattern BlanchissageTab)

**Créer** `frontend/src/components/amortissements/DotationTab.tsx` — 2 états :

**État 1 — non générée** (`useDotationGenere(year).data === null`) :

```tsx
import { Calculator, TrendingDown, FileText, CheckCircle2 } from 'lucide-react';
import { useDotationVirtualDetail, useGenererDotation, useDotationGenere } from '@/hooks/useAmortissements';

export function DotationTab({ year }: { year: number }) {
  const { data: detail, isLoading } = useDotationVirtualDetail(year);
  const { data: dotationGenere } = useDotationGenere(year);
  const generer = useGenererDotation();

  if (isLoading) return <Skeleton />;
  if (!detail || detail.nb_immos_actives === 0) return <EmptyState />;

  if (dotationGenere) {
    return <DotationEtat2 year={year} detail={detail} dotationGenere={dotationGenere} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Dotation brute" value={formatEuro(detail.total_brute)} />
        <MetricCard label="Déductible" value={formatEuro(detail.total_deductible)} accent />
        <MetricCard label="Immos actives" value={String(detail.nb_immos_actives)} />
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/30 rounded-md p-3 flex gap-2.5">
        <Info size={14} className="shrink-0 mt-0.5 text-blue-900 dark:text-blue-300" />
        <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
          La dotation sera comptabilisée en OD au 31/12/{year} dans le fichier de décembre,
          avec un PDF rapport enregistré dans la GED. Opération verrouillée (
          <code className="text-[11px] bg-white/50 dark:bg-black/30 px-1 rounded">locked: true</code>).
        </p>
      </div>

      {/* Tableau récap immos contributives (lecture seule) */}
      <DotationImmoTable immos={detail.immos} />

      <button
        onClick={() => {
          generer.mutate(year, {
            onSuccess: () => toast.success(`Dotation ${year} générée`, { /* style brandé */ }),
          });
        }}
        disabled={generer.isPending}
        className="w-full py-3 rounded-md bg-[#3C3489] text-white font-medium hover:bg-[#26215C] disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <TrendingDown size={16} />
        Générer la dotation {year}
      </button>
    </div>
  );
}
```

**État 2 — déjà générée** (`DotationEtat2`) :

```tsx
function DotationEtat2({ year, detail, dotationGenere }) {
  const supprimer = useSupprimerDotation();
  const regenerer = useRegenererPdfDotation();
  const navigate = useNavigate();
  const openSendDrawer = useSendDrawerStore((s) => s.open);

  return (
    <div className="space-y-6">
      {/* Checklist 3✓ */}
      <div className="space-y-2">
        <ChecklistItem done label="OD créée au 31/12" />
        <ChecklistItem done label="PDF rapport généré" />
        <ChecklistItem done label="Enregistré dans la GED" />
      </div>

      {/* Thumbnail PDF cliquable */}
      <PdfThumbnail
        docId={dotationGenere.ged_doc_id}
        onClick={() => setPdfPreviewOpen(true)}
      />

      {/* Boutons action */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate(`/ged?doc=${encodeURIComponent(dotationGenere.ged_doc_id)}`)}>
          Ouvrir dans GED
        </button>
        <button onClick={() =>
          navigate(`/editor?file=${dotationGenere.filename}&highlight=${dotationGenere.index}&from=amortissements`)
        }>
          Ouvrir dans l'éditeur
        </button>
        <button onClick={() => regenerer.mutate(year)}>Regénérer PDF</button>
        <button onClick={() => openSendDrawer({
          preselect: [{ type: 'rapport', docId: dotationGenere.ged_doc_id }],
          defaultSubject: `Dotation aux amortissements ${year}`,
        })}>
          Envoyer au comptable
        </button>
        <button
          onClick={() => {
            if (confirm(`Supprimer la dotation ${year} ? L'OD et le PDF seront retirés.`)) {
              supprimer.mutate(year);
            }
          }}
          className="col-span-2 text-red-600 hover:bg-red-50"
        >
          Supprimer
        </button>
      </div>

      {/* PdfPreviewDrawer si ouvert */}
      {pdfPreviewOpen && <PdfPreviewDrawer docId={dotationGenere.ged_doc_id} onClose={() => setPdfPreviewOpen(false)} />}
    </div>
  );
}
```

### Étape 3 — Intégration dans `AmortissementsPage`

**`frontend/src/pages/AmortissementsPage.tsx`** :

Ajouter le 5ᵉ onglet `Dotation` avec icône `Calculator`. Lire `?tab=dotation` en URL param pour sélection automatique.

```tsx
const tabs = [
  { id: 'registre', label: 'Registre', icon: List },
  { id: 'tableau', label: 'Tableau annuel', icon: Calendar },
  { id: 'synthese', label: 'Synthèse par poste', icon: BarChart3 },
  { id: 'candidates', label: 'Candidates', icon: Sparkles },
  { id: 'dotation', label: 'Dotation', icon: Calculator, badge: needsDotation ? 'amber' : undefined },
];

const [activeTab, setActiveTab] = useState<string>(() => {
  const param = searchParams.get('tab');
  return param && tabs.find(t => t.id === param) ? param : 'registre';
});
```

`needsDotation` = `!dotationGenere && nb_immos_actives > 0` → badge ambre sur l'onglet pour rappel visuel.

### Étape 4 — Badges `ImmoBadge` + `DotationBadge`

**Créer** `frontend/src/components/shared/ImmoBadge.tsx` :

```tsx
import { Package } from 'lucide-react';

interface Props {
  immobilisationId: string;
  orphan?: boolean;
  onClick?: () => void;
}

export function ImmoBadge({ immobilisationId, orphan, onClick }: Props) {
  const tooltip = orphan
    ? 'Immobilisation introuvable — cliquez pour régulariser'
    : 'Immobilisation — voir le tableau d\'amortissement';

  const style = orphan
    ? 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700'
    : 'bg-[#EEEDFE] text-[#3C3489] border border-[#CECBF6] dark:bg-[#3C3489]/30 dark:text-[#CECBF6] dark:border-[#3C3489]';

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${style} hover:ring-1 hover:ring-current/30`}
    >
      <Package size={10} />
      {orphan ? 'Immo ?' : 'Immo'}
    </button>
  );
}
```

**Créer** `frontend/src/components/shared/DotationBadge.tsx` :

```tsx
import { TrendingDown } from 'lucide-react';

export function DotationBadge({ year, onClick }: { year: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Écriture OD · exercice ${year}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#CECBF6] text-[#26215C] border border-[#7F77DD] dark:bg-[#26215C]/40 dark:text-[#CECBF6] dark:border-[#3C3489] hover:ring-1 hover:ring-current/30"
    >
      <TrendingDown size={10} />
      Dotation
    </button>
  );
}
```

### Étape 5 — Intégration badges dans 3 pages

Dans **EditorPage**, **JustificatifsPage**, **AlertesPage**, au niveau de la cellule Catégorie (même slot que `NoteDeFraisBadge` existant) :

```tsx
// Fetch immos pour détection orphan au niveau page
const { data: immosList } = useImmobilisations();
const immosMap = useMemo(
  () => Object.fromEntries((immosList ?? []).map(i => [i.id, i])),
  [immosList]
);

// Dans le render de la cellule Catégorie
{op.immobilisation_id && (
  <ImmoBadge
    immobilisationId={op.immobilisation_id}
    orphan={!immosMap[op.immobilisation_id]}
    onClick={() => openImmobilisationDrawer(op.immobilisation_id)}
  />
)}
{op.source === 'amortissement' && (
  <DotationBadge
    year={parseInt(op.Date.slice(0, 4))}
    onClick={() => navigate(`/compta-analytique?year=${parseInt(op.Date.slice(0, 4))}&category=${encodeURIComponent('Dotations aux amortissements')}`)}
  />
)}
```

`openImmobilisationDrawer(id)` : helper qui ouvre `ImmobilisationDrawer` en mode lecture sur cet ID (via store Zustand ou state local selon le pattern actuel de la page).

### Étape 6 — Filtre `Type d'opération` étendu

Étendre le filtre existant (déjà présent pour `Note de frais`) dans 4 endroits :
- `EditorPage` Filtres panel
- `JustificatifsPage` toolbar
- `ReportsPage` pill buttons (si applicable)
- `ComptaAnalytiquePage` `RepartitionParTypeCard`

Logique de filtre :

```ts
function matchesType(op: Operation, type: OperationType): boolean {
  switch (type) {
    case 'all': return true;
    case 'bancaire': return !op.source && !op.immobilisation_id;
    case 'note_de_frais': return op.source === 'note_de_frais';
    case 'immobilisation': return !!op.immobilisation_id;
    case 'dotation': return op.source === 'amortissement';
  }
}
```

**`RepartitionParTypeCard.tsx`** : étendre à 5 types, afficher compteur + share % pour chaque. Pattern existant à prolonger (pas de refonte structurelle).

### Étape 7 — `ImmobilisationDrawer` enrichi

**`frontend/src/components/amortissements/ImmobilisationDrawer.tsx`** — en mode création depuis candidate (prop `candidateSource: {filename, index}`) :

**Section "Opération source"** au-dessus du formulaire standard :

```tsx
const { data: candidateDetail } = useCandidateDetail(
  candidateSource?.filename ?? null,
  candidateSource?.index ?? null,
);

// Préfill automatique au mount via useEffect
useEffect(() => {
  if (candidateDetail?.ocr_prefill && mode === 'create') {
    setForm((f) => ({
      ...f,
      designation: f.designation || candidateDetail.ocr_prefill.designation,
      date_acquisition: f.date_acquisition || candidateDetail.ocr_prefill.date_acquisition,
      base_amortissable: f.base_amortissable || candidateDetail.ocr_prefill.base_amortissable,
    }));
  }
}, [candidateDetail?.ocr_prefill]);
```

Rendu de la section :

```tsx
{candidateSource && candidateDetail && (
  <div className="space-y-3 pb-4 mb-4 border-b border-gray-200 dark:border-gray-700">
    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
      Opération source
    </p>

    {/* Carte op readonly */}
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-md p-3 border border-gray-200 dark:border-gray-700">
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{candidateDetail.operation['Libellé']}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDateFr(candidateDetail.operation['Date'])} · {candidateDetail.operation['Catégorie']}
            {candidateDetail.operation['Sous-catégorie'] && ` / ${candidateDetail.operation['Sous-catégorie']}`}
          </p>
        </div>
        <p className="text-sm font-medium tabular-nums text-red-600">
          −{formatEuro(Math.abs(candidateDetail.operation['Débit'] ?? 0))}
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate(`/editor?file=${candidateSource.filename}&highlight=${candidateSource.index}&from=amortissements`)}
        className="mt-2 text-xs text-[#3C3489] hover:underline flex items-center gap-1"
      >
        Voir dans l'éditeur <ArrowRight size={10} />
      </button>
    </div>

    {/* Bloc justificatif */}
    {candidateDetail.justificatif ? (
      <JustificatifPreviewBlock
        justificatif={candidateDetail.justificatif}
        onExpand={() => setShowJustifSubDrawer(true)}
      />
    ) : (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-md p-3 flex items-start gap-2.5">
        <AlertTriangle size={14} className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-900 dark:text-amber-200 mb-1.5">
            Aucun justificatif associé à cette opération
          </p>
          <button
            type="button"
            onClick={() => openManualAssociationDrawer(candidateSource)}
            className="text-xs text-amber-700 dark:text-amber-300 underline hover:text-amber-900"
          >
            Associer un justificatif
          </button>
        </div>
      </div>
    )}
  </div>
)}
```

**`JustificatifPreviewBlock`** — thumbnail cliquable :

```tsx
function JustificatifPreviewBlock({ justificatif, onExpand }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-md">
      <div className="relative group cursor-pointer" onClick={onExpand} style={{ width: 80, height: 100 }}>
        <PdfThumbnail
          filename={justificatif.filename}
          className="w-full h-full object-cover rounded border"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
          <Expand size={16} className="text-white" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{justificatif.filename}</p>
        {justificatif.ocr_data.supplier && (
          <p className="text-xs text-gray-500 mt-0.5">{justificatif.ocr_data.supplier}</p>
        )}
        {justificatif.ocr_data.best_amount && (
          <p className="text-xs text-gray-500">{formatEuro(justificatif.ocr_data.best_amount)}</p>
        )}
      </div>
    </div>
  );
}
```

**Sous-drawer preview** (pattern miroir EditorPage) :

```tsx
{showJustifSubDrawer && candidateDetail?.justificatif && (
  <PreviewSubDrawer
    filename={candidateDetail.justificatif.filename}
    onClose={() => setShowJustifSubDrawer(false)}
    onOpenNative={(name) => api.post(`/justificatifs/${name}/open-native`)}
    style={{ right: '650px', width: '700px' }}
  />
)}
```

**Warning ambre non bloquant** en footer si save sans justif :

```tsx
{!candidateDetail?.justificatif && mode === 'create' && (
  <p className="text-xs text-amber-700 dark:text-amber-300 mt-3 flex items-start gap-1.5">
    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
    Création sans justificatif associé — à régulariser ensuite via JustificatifsPage
  </p>
)}
```

### Étape 8 — Navigation bidirectionnelle

**URL params supportés** :

| Route | Params | Comportement |
|---|---|---|
| `/editor` | `?file=X&highlight=idx&from=Y` | Highlight row + breadcrumb `← Retour à {Y}` |
| `/compta-analytique` | `?year=X&category=...` | Ouvre auto `CategoryDetailDrawer` (ou virtual variant) |
| `/amortissements` | `?tab=dotation`, `?immo_id=X` | Onglet + scroll-to immo |
| `/ged` | `?doc=path` | Ouvre `GedDocumentDrawer` |

**`ComptaAnalytiquePage.tsx`** — auto-open via URL param :

```tsx
useEffect(() => {
  const categoryParam = searchParams.get('category');
  if (categoryParam && dashboardData) {
    const cat = dashboardData.categories.find(c => c.categorie === categoryParam);
    if (cat) {
      openCategoryDrawer(cat);
      // Nettoyer l'URL pour éviter re-open au refresh
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('category');
        return next;
      });
    }
  }
}, [searchParams, dashboardData]);
```

**`EditorPage.tsx`** — breadcrumb contextuel en haut :

```tsx
const fromParam = searchParams.get('from');
const fromLabels: Record<string, string> = {
  amortissements: 'Amortissements',
  'compta-analytique': 'Compta Analytique',
  ged: 'GED',
};

{fromParam && fromLabels[fromParam] && (
  <button
    onClick={() => navigate(`/${fromParam}`)}
    className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#3C3489] transition-colors"
  >
    <ArrowLeft size={14} />
    Retour à {fromLabels[fromParam]}
  </button>
)}
```

**`highlight` persistant** — pattern `isNavTarget` déjà en place (sandbox toast) à réutiliser pour le surlignage de ligne `bg-warning/10`.

**`AmortissementsPage` `?immo_id=X`** :

```tsx
useEffect(() => {
  const immoId = searchParams.get('immo_id');
  if (immoId && immosData) {
    setActiveTab('registre');
    // Scroll into view + highlight temporaire
    setTimeout(() => {
      document.getElementById(`immo-row-${immoId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}, [searchParams, immosData]);
```

**Boutons navigation à ajouter** dans `DotationsVirtualDrawer` (celui créé en A2) :

```tsx
// Cartes immo cliquables
<div className="cursor-pointer" onClick={() => openImmobilisationDrawer(immo.immobilisation_id)}>
  {/* Card content existant */}
</div>

// Footer — bouton Voir l'OD
const { data: dotationRef } = useDotationRef(year);

<div className="flex gap-2">
  {dotationRef && (
    <button
      onClick={() => navigate(`/editor?file=${dotationRef.filename}&highlight=${dotationRef.index}&from=compta-analytique`)}
      className="text-xs px-3 py-1.5 rounded-md border flex items-center gap-1"
    >
      Voir l'OD ↗
    </button>
  )}
  <button onClick={goToRegister}>Voir le registre ↗</button>
</div>
```

---

## Tests manuels

1. **Onglet Dotation état 1** : sur `/amortissements?tab=dotation&year=2026` sans dotation générée → tableau récap + 3 MetricCards + bouton "Générer la dotation 2026". Clic → toast success + transition vers état 2.
2. **Onglet Dotation état 2** : checklist 3✓ + thumbnail PDF cliquable + 5 boutons action. "Regénérer PDF" lance mutation + thumbnail mis à jour.
3. **Badge onglet** : si pas de dotation générée et immos actives > 0 → badge ambre sur l'onglet "Dotation".
4. **ImmoBadge cliquable** : dans EditorPage sur op immobilisée → clic badge `Immo` violet ouvre `ImmobilisationDrawer` en lecture.
5. **ImmoBadge orphan** : supprimer une immo référencée → badge ambre `Immo ?` au prochain render.
6. **DotationBadge** : sur l'OD dotation dans l'éditeur décembre → badge `Dotation` violet foncé, clic → `/compta-analytique?year=2026&category=...` → `DotationsVirtualDrawer` s'ouvre auto.
7. **Filtre Immobilisation** : dans EditorPage, filtre Type d'op = "Immobilisation" → seules les ops avec `immobilisation_id` apparaissent.
8. **Filtre Dotation** : même pattern avec `source === "amortissement"`.
9. **Préfill OCR** : candidate avec `.ocr.json` valide → `ImmobilisationDrawer` ouvre pré-rempli (désignation = supplier + libellé, date = best_date, base = best_amount).
10. **Sous-drawer justif** : clic thumbnail dans `ImmobilisationDrawer` → `PreviewSubDrawer` slide à gauche (`right: 650px`, width 700px). Esc ferme uniquement le sub-drawer.
11. **Pas de justif** : candidate sans justif → encadré ambre "Aucun justificatif" + bouton "Associer" → ouvre `ManualAssociationDrawer` ciblé.
12. **Warning save sans justif** : valider création sans associer de justif → immo créée, warning ambre en toast/footer non bloquant.
13. **Navigation bidirectionnelle complète** :
    - `/compta-analytique` → clic ligne Dotations → drawer ouvre → clic carte immo → `ImmobilisationDrawer`
    - Dans `ImmobilisationDrawer` → bouton "Voir dans l'éditeur" → `/editor?file=X&highlight=idx&from=amortissements`
    - Breadcrumb `← Retour à Amortissements` visible → clic → `/amortissements`
14. **Scroll immo** : `/amortissements?immo_id=XXX` → onglet registre + scroll auto sur la ligne concernée + highlight temporaire.

## CLAUDE.md — à ajouter

```markdown
- **Onglet Dotation (AmortissementsPage)** : 5ᵉ onglet avec icône `Calculator`,
  pattern strict `BlanchissageTab`. URL param `?tab=dotation` sélectionne
  automatiquement. Badge amber si `!dotationGenere && nb_immos_actives > 0`.
  2 états : saisie (3 MetricCards + tableau récap + bouton Générer) ou généré
  (checklist 3✓ + thumbnail PDF + 5 boutons : GED / Éditeur / Regénérer PDF /
  Envoyer comptable / Supprimer).

- **Badges Immo + Dotation** : composants partagés dans
  `components/shared/ImmoBadge.tsx` (violet `#EEEDFE`/`#3C3489`, icône
  `Package`) et `DotationBadge.tsx` (violet foncé `#CECBF6`/`#26215C`,
  icône `TrendingDown`). Affichés au-dessus de la cellule Catégorie dans
  EditorPage + JustificatifsPage + AlertesPage, même slot que
  `NoteDeFraisBadge`. Détection orphan (immo introuvable dans `useImmobilisations()`)
  → badge ambre "Immo ?". Clic Immo → `ImmobilisationDrawer`, clic Dotation →
  `/compta-analytique?year=X&category=Dotations+aux+amortissements`.

- **Filtre Type d'opération étendu** : ajout valeurs `Immobilisation` (`op.immobilisation_id != null`)
  et `Dotation` (`op.source === "amortissement"`) dans EditorPage Filtres,
  JustificatifsPage toolbar, ReportsPage pill buttons, ComptaAnalytique
  `RepartitionParTypeCard` (5 types total avec compteur + share %).

- **ImmobilisationDrawer enrichi — section op source** : en mode création
  depuis candidate, affiche carte op readonly (libellé + date + cat +
  montant + bouton "Voir dans l'éditeur") + bloc justificatif (3 états :
  thumbnail cliquable + `PreviewSubDrawer` à `right: 650px` width 700px /
  bouton "Associer" → `ManualAssociationDrawer` ciblé / cas ventilée).
  Préfill automatique du formulaire depuis `/candidate-detail.ocr_prefill`
  (designation = supplier + libellé, date = best_date, base = best_amount).
  Warning ambre non bloquant si save sans justif.

- **Navigation bidirectionnelle amortissements** : URL params supportés :
  `?from=amortissements|compta-analytique|ged` (breadcrumb `← Retour`),
  `?category=Dotations+aux+amortissements` sur `/compta-analytique`
  (auto-open `DotationsVirtualDrawer` via `useEffect`, URL param nettoyé
  après open pour éviter ré-ouverture au refresh), `?tab=dotation` sur
  `/amortissements`, `?immo_id=X` (scroll-to + highlight temporaire).
  Boutons `→` dans `ImmobilisationDrawer` (op source + justif GED),
  `DotationsVirtualDrawer` (cartes immo cliquables + bouton "Voir l'OD ↗"
  si `useDotationRef(year)` retourne non-null + bouton "Voir le registre ↗").
```

## Commits suggérés

1. `feat(frontend): types + hooks OD dotation (generer/supprimer/regenerer/genere/candidate-detail)`
2. `feat(frontend): DotationTab + intégration 5e onglet AmortissementsPage`
3. `feat(frontend): ImmoBadge + DotationBadge composants partagés`
4. `feat(frontend): intégration badges EditorPage + JustificatifsPage + AlertesPage`
5. `feat(frontend): filtre Type d'op étendu (Immobilisation + Dotation) 4 pages`
6. `feat(frontend): ImmobilisationDrawer section op source + préfill OCR + sous-drawer justif`
7. `feat(frontend): navigation bidirectionnelle complète (URL params + breadcrumb + auto-open drawer)`
8. `docs: CLAUDE.md — frontend UX amortissements`
