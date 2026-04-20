# Prompt A2 — Amortissements : frontend fiscal (avec section reprise exercice antérieur)

## Contexte

Le Prompt A1 a livré le backend fiscal (BNC centralisé, exclusion charges, ligne virtuelle, endpoints `/virtual-detail` + `/dotation-ref` + `/compute-backfill`, modèle `Immobilisation` enrichi avec 3 champs reprise). Il faut maintenant exposer ça côté UI :

1. Synchroniser le sélecteur année d'`AmortissementsPage` avec le store global sidebar
2. Masquer le sélecteur de mode dans `ImmobilisationDrawer` (linéaire forcé)
3. Simplifier `ConfigAmortissementsDrawer` (suppression section catégories éligibles)
4. **Ajouter section "Reprise d'exercice antérieur"** dans `ImmobilisationDrawer` (toggle collapsible) avec calcul auto via `/compute-backfill`
5. **Créer `DotationsVirtualDrawer`** spécialisé pour la ligne virtuelle (mockup validé)
6. Router `CategoryDetailDrawer` vers le drawer spécialisé
7. Badge `Reprise` dans le registre des immos

## Dépendances

**Prompt A1 exécuté et commité.** Endpoints opérationnels :
- `GET /api/amortissements/virtual-detail?year=X`
- `GET /api/amortissements/dotation-ref/{year}`
- `POST /api/amortissements/compute-backfill`
- Ligne `is_virtual: true` présente dans `GET /api/analytics/dashboard`

## Fichiers touchés

- `frontend/src/pages/AmortissementsPage.tsx` — store year + badge reprise dans le registre
- `frontend/src/components/amortissements/ImmobilisationDrawer.tsx` — mode masqué + **section reprise**
- `frontend/src/components/amortissements/ConfigAmortissementsDrawer.tsx` — simplifié
- **Créer** `frontend/src/components/analytics/DotationsVirtualDrawer.tsx`
- `frontend/src/components/analytics/CategoryDetailDrawer.tsx` — branchement
- `frontend/src/hooks/useAmortissements.ts` — 3 hooks
- `frontend/src/types/index.ts` — types

---

## Étapes ordonnées

### Étape 1 — Types

**`frontend/src/types/index.ts`** :

```ts
export interface DotationImmoRow {
  immobilisation_id: string;
  designation: string;
  date_acquisition: string;
  mode: string;
  duree: number;
  base_amortissable: number;
  vnc_debut: number;
  dotation_brute: number;
  quote_part_pro: number;
  dotation_deductible: number;
  vnc_fin: number;
  statut: 'en_cours' | 'complement' | 'derniere' | 'cedee';
  poste: string | null;
  is_reprise: boolean;
  exercice_entree_neuronx: number | null;
}

export interface AmortissementVirtualDetail {
  year: number;
  total_brute: number;
  total_deductible: number;
  nb_immos_actives: number;
  immos: DotationImmoRow[];
}

export interface DotationRef {
  filename: string;
  index: number;
  year: number;
}

export interface BackfillComputeRequest {
  date_acquisition: string;
  base_amortissable: number;
  duree: number;
  exercice_entree_neuronx: number;
  quote_part_pro?: number;
}

export interface BackfillComputeResponse {
  amortissements_anterieurs_theorique: number;
  vnc_ouverture_theorique: number;
  detail_exercices_anterieurs: Array<{
    exercice: number;
    dotation: number;
    vnc_fin: number;
  }>;
}

// Étendre le type Immobilisation existant
export interface Immobilisation {
  id: string;
  designation: string;
  date_acquisition: string;
  base_amortissable: number;
  duree: number;
  mode: string;
  quote_part_pro: number;
  poste: string | null;
  statut: string;
  date_sortie?: string | null;
  prix_cession?: number | null;
  motif_sortie?: string | null;
  // NOUVEAUX
  exercice_entree_neuronx: number | null;
  amortissements_anterieurs: number;
  vnc_ouverture: number | null;
  operation_source?: { filename: string; index: number } | null;
  created_at?: string | null;
}

export interface CategoryDashboard {
  categorie: string;
  total_debit: number;
  total_credit: number;
  nb_ops: number;
  is_virtual?: boolean;
  source?: string;
}
```

### Étape 2 — Hooks

**`frontend/src/hooks/useAmortissements.ts`** :

```ts
export function useDotationVirtualDetail(year: number) {
  return useQuery<AmortissementVirtualDetail>({
    queryKey: ['amortissements', 'virtual-detail', year],
    queryFn: () => api.get(`/amortissements/virtual-detail?year=${year}`),
  });
}

export function useDotationRef(year: number) {
  return useQuery<DotationRef | null>({
    queryKey: ['amortissements', 'dotation-ref', year],
    queryFn: () => api.get(`/amortissements/dotation-ref/${year}`),
  });
}

export function useComputeBackfill() {
  return useMutation<BackfillComputeResponse, Error, BackfillComputeRequest>({
    mutationFn: (req) => api.post('/amortissements/compute-backfill', req),
  });
}
```

### Étape 3 — `AmortissementsPage` → `useFiscalYearStore`

**`frontend/src/pages/AmortissementsPage.tsx`** :

Remplacer le `useState<number>` local (si présent) par le store global :

```tsx
import { useFiscalYearStore } from '@/stores/useFiscalYearStore';

const year = useFiscalYearStore((s) => s.year);
const setYear = useFiscalYearStore((s) => s.setYear);
```

Propager `year` dans tous les hooks de la page :
- `useAmortKpis(year)`
- `useDotations(year)` (onglet Tableau annuel)
- `useSyntheseParPoste(year)` (si existe)
- Candidates (filtre date si applicable)
- `useProjections` (base = year)

**Dans le tableau Registre** (onglet 1), ajouter un badge `Reprise` sur les lignes d'immos avec `exercice_entree_neuronx !== null` :

```tsx
{immo.exercice_entree_neuronx !== null && (
  <span
    className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700 font-medium ml-2"
    title={`Reprise depuis ${immo.exercice_entree_neuronx} — acquisition réelle ${immo.date_acquisition.slice(0, 4)}`}
  >
    Reprise {immo.exercice_entree_neuronx}
  </span>
)}
```

**Pattern de sync différée** : s'il y a un `YearSelector` local dans la page, reprendre le pattern de `EditorPage` — attendre que `useOperationFiles` ait chargé avant de pousser dans le store (évite d'écraser la valeur persistée).

### Étape 4 — `ImmobilisationDrawer` : mode linéaire verrouillé

**`frontend/src/components/amortissements/ImmobilisationDrawer.tsx`** :

- Initialiser `mode` à `"lineaire"` dans l'état initial
- Remplacer le `<select mode>` par un pavé readonly

```tsx
<div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-md border border-gray-200 dark:border-gray-700">
  <span className="text-xs text-gray-500 dark:text-gray-400">Mode</span>
  <span className="text-sm font-medium">Linéaire</span>
  <button
    type="button"
    title="Le dégressif est réservé à la comptabilité d'engagement (option formelle formulaire 2036). Non applicable en BNC régime recettes."
    className="ml-auto text-gray-400 hover:text-gray-600"
  >
    <Info size={14} />
  </button>
</div>
```

**Edge case legacy** : si `immo.mode === "degressif"` (cas post-migration improbable) → afficher la valeur réelle en readonly, ne pas l'écraser au save.

### Étape 5 — `ImmobilisationDrawer` : section "Reprise d'exercice antérieur"

Ajouter une section collapsible (repliée par défaut) sous le champ `durée` (ou cohérent avec le flux actuel du drawer). Uniquement visible **en mode création** (pas en édition d'immo existante — modifier un backfill a posteriori serait instable).

**État local** :

```tsx
const [isReprise, setIsReprise] = useState(false);
const [exerciceEntree, setExerciceEntree] = useState<number>(new Date().getFullYear());
const [amortAnterieurs, setAmortAnterieurs] = useState<number>(0);
const [vncOuverture, setVncOuverture] = useState<number>(0);
const [backfillManuallyEdited, setBackfillManuallyEdited] = useState(false);

const computeBackfill = useComputeBackfill();
```

**Calcul auto déclenché quand les 4 inputs de base changent** (`date_acquisition`, `base_amortissable`, `duree`, `exerciceEntree`), via un `useEffect` debounce 400 ms — uniquement si `!backfillManuallyEdited` :

```tsx
useEffect(() => {
  if (!isReprise || backfillManuallyEdited) return;
  if (!dateAcquisition || !baseAmortissable || !duree || !exerciceEntree) return;

  // Validation côté UI avant de call
  const yearAcq = parseInt(dateAcquisition.slice(0, 4));
  if (exerciceEntree <= yearAcq) return;

  const timeoutId = setTimeout(() => {
    computeBackfill.mutate(
      {
        date_acquisition: dateAcquisition,
        base_amortissable: baseAmortissable,
        duree,
        exercice_entree_neuronx: exerciceEntree,
        quote_part_pro: quotePartPro,
      },
      {
        onSuccess: (res) => {
          setAmortAnterieurs(res.amortissements_anterieurs_theorique);
          setVncOuverture(res.vnc_ouverture_theorique);
        },
      },
    );
  }, 400);

  return () => clearTimeout(timeoutId);
}, [dateAcquisition, baseAmortissable, duree, exerciceEntree, quotePartPro, isReprise, backfillManuallyEdited]);
```

**Rendu** :

```tsx
<div className="pt-4 border-t border-gray-200 dark:border-gray-700">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={isReprise}
      onChange={(e) => {
        setIsReprise(e.target.checked);
        if (!e.target.checked) {
          setAmortAnterieurs(0);
          setVncOuverture(0);
          setBackfillManuallyEdited(false);
        }
      }}
      className="w-4 h-4 rounded border-gray-300 text-[#3C3489] focus:ring-[#3C3489]"
    />
    <span className="text-sm font-medium">Reprise d'une immobilisation existante</span>
    <span className="text-xs text-gray-500">(achat antérieur à NeuronXcompta)</span>
  </label>

  {isReprise && (
    <div className="mt-3 pl-6 space-y-3">
      {/* Exercice d'entrée */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
          Exercice d'entrée dans NeuronX
        </label>
        <select
          value={exerciceEntree}
          onChange={(e) => {
            setExerciceEntree(parseInt(e.target.value));
            setBackfillManuallyEdited(false);
          }}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
        >
          {Array.from({ length: 10 }, (_, i) => {
            const y = new Date().getFullYear() - 5 + i;
            const yAcq = parseInt(dateAcquisition?.slice(0, 4) || '0');
            if (y <= yAcq) return null;
            return <option key={y} value={y}>{y}</option>;
          })}
        </select>
        {dateAcquisition && (
          <p className="text-[11px] text-gray-500 mt-1">
            Acquisition : {dateAcquisition.slice(0, 4)} · {exerciceEntree - parseInt(dateAcquisition.slice(0, 4))} exercice(s) antérieur(s)
          </p>
        )}
      </div>

      {/* Cumul amortissements antérieurs */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1 flex items-center gap-1">
          Cumul amortissements antérieurs
          {computeBackfill.isPending && <Loader2 size={10} className="animate-spin" />}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            value={amortAnterieurs}
            onChange={(e) => {
              setAmortAnterieurs(parseFloat(e.target.value) || 0);
              setBackfillManuallyEdited(true);
            }}
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 tabular-nums"
          />
          <span className="text-sm text-gray-500">€</span>
        </div>
      </div>

      {/* VNC ouverture */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
          VNC d'ouverture {exerciceEntree}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            value={vncOuverture}
            onChange={(e) => {
              setVncOuverture(parseFloat(e.target.value) || 0);
              setBackfillManuallyEdited(true);
            }}
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 tabular-nums"
          />
          <span className="text-sm text-gray-500">€</span>
        </div>
      </div>

      {/* Bouton recalcul manuel */}
      {backfillManuallyEdited && (
        <button
          type="button"
          onClick={() => {
            setBackfillManuallyEdited(false);
            // Le useEffect se relance automatiquement
          }}
          className="text-xs text-[#3C3489] hover:underline flex items-center gap-1"
        >
          <RefreshCw size={10} /> Recalculer depuis la durée légale
        </button>
      )}

      {/* Validation temps réel */}
      {isReprise && (
        <div className={`text-xs px-3 py-2 rounded-md flex items-start gap-2 ${
          Math.abs(amortAnterieurs + vncOuverture - baseAmortissable) > 1
            ? 'bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 border border-red-200'
            : 'bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-200 border border-green-200'
        }`}>
          {Math.abs(amortAnterieurs + vncOuverture - baseAmortissable) > 1 ? (
            <>
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                Incohérence : {formatEuro(amortAnterieurs)} + {formatEuro(vncOuverture)} ={' '}
                {formatEuro(amortAnterieurs + vncOuverture)} ≠ base {formatEuro(baseAmortissable)}
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
              <span>Cohérence validée · base = antérieurs + VNC ouverture</span>
            </>
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs bg-blue-50 dark:bg-blue-950/30 rounded-md p-2.5 flex items-start gap-2 text-blue-900 dark:text-blue-200">
        <Info size={12} className="shrink-0 mt-0.5" />
        <p>
          NeuronXcompta ne produira aucune dotation pour les exercices antérieurs
          à {exerciceEntree}. Les {formatEuro(amortAnterieurs)} cumulés sont hors scope
          fiscal NeuronX (supposés déjà passés par votre ancien comptable).
        </p>
      </div>
    </div>
  )}
</div>
```

**Payload de soumission** : si `isReprise` est `true` :

```tsx
const payload: ImmobilisationCreate = {
  // champs standard
  designation,
  date_acquisition: dateAcquisition,
  base_amortissable: baseAmortissable,
  duree,
  mode: 'lineaire',
  quote_part_pro: quotePartPro,
  poste,
  operation_source: candidateSource ?? null,
  // champs reprise
  exercice_entree_neuronx: isReprise ? exerciceEntree : null,
  amortissements_anterieurs: isReprise ? amortAnterieurs : 0,
  vnc_ouverture: isReprise ? vncOuverture : null,
};
```

**Désactiver le bouton Enregistrer** si `isReprise && incohérence`.

### Étape 6 — `ConfigAmortissementsDrawer` simplifié

**`frontend/src/components/amortissements/ConfigAmortissementsDrawer.tsx`** :

- **Supprimer** toute la section "Catégories éligibles"
- **Garder** : seuil, sous-catégories exclues, durées par défaut (par sous-catégorie)
- **Ajouter** au-dessus du seuil une note :

```tsx
<div className="flex items-start gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-md text-xs text-blue-900 dark:text-blue-200">
  <Info size={14} className="shrink-0 mt-0.5" />
  <p>
    Seule la catégorie <code className="font-mono bg-white/50 dark:bg-black/30 px-1 rounded">Matériel</code>
    {' '}est analysée pour la détection automatique des candidates. Les autres catégories
    restent immobilisables manuellement via le bouton "Nouvelle immobilisation".
  </p>
</div>
```

### Étape 7 — `DotationsVirtualDrawer` (mockup validé)

**Créer** `frontend/src/components/analytics/DotationsVirtualDrawer.tsx` — drawer 650px. Structure du mockup validé précédemment.

```tsx
import { X, TrendingDown, Info, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDotationVirtualDetail } from '@/hooks/useAmortissements';
import { useFiscalYearStore } from '@/stores/useFiscalYearStore';
import { formatEuro } from '@/lib/utils';

interface Props {
  year: number;
  onClose: () => void;
}

export function DotationsVirtualDrawer({ year, onClose }: Props) {
  const navigate = useNavigate();
  const setYear = useFiscalYearStore((s) => s.setYear);
  const { data: detail, isLoading } = useDotationVirtualDetail(year);

  const goToRegister = () => {
    setYear(year);
    navigate('/amortissements');
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[650px] bg-white dark:bg-gray-900 shadow-2xl z-50 overflow-y-auto">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#EEEDFE] dark:bg-[#3C3489]/30 flex items-center justify-center">
            <TrendingDown size={16} className="text-[#3C3489] dark:text-[#CECBF6]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">Dotations aux amortissements</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#3C3489]/30 dark:text-[#CECBF6] font-medium">
                calculé
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Exercice {year} · source amortissement_service
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center">
          <X size={14} />
        </button>
      </div>

      {isLoading ? (
        <SkeletonLoader />
      ) : !detail || detail.nb_immos_actives === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* 3 MetricCards */}
          <div className="px-5 py-4 grid grid-cols-3 gap-2.5">
            <MetricCard label="Dotation brute" value={formatEuro(detail.total_brute)} />
            <MetricCard label="Déductible" value={formatEuro(detail.total_deductible)} accent />
            <MetricCard label="Immos actives" value={String(detail.nb_immos_actives)} />
          </div>

          {/* Bandeau info */}
          <div className="mx-5 mb-4 px-3 py-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-md flex items-start gap-2.5">
            <Info size={14} className="shrink-0 mt-0.5 text-blue-900 dark:text-blue-300" />
            <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
              Ces lignes sont virtuelles — elles ne proviennent pas du relevé bancaire.
              Elles remplacent les sorties de trésorerie de la catégorie{' '}
              <code className="font-mono bg-white/50 dark:bg-black/30 px-1 rounded text-[11px]">Immobilisations</code>
              {' '}dans le calcul du BNC.
            </p>
          </div>

          {/* Liste immos */}
          <div className="px-5 pb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium mb-2.5">
              Immobilisations contributives
            </p>
            {detail.immos.map((immo) => (
              <ImmoCard key={immo.immobilisation_id} immo={immo} />
            ))}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 px-5 py-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {detail.nb_immos_actives} immos · total déductible{' '}
              <span className="font-medium text-[#3C3489] dark:text-[#CECBF6]">
                {formatEuro(detail.total_deductible)}
              </span>
            </p>
            <button
              onClick={goToRegister}
              className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
            >
              Voir le registre <ArrowRight size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

**Sous-composant `ImmoCard`** (avec badge Reprise si applicable) :

```tsx
function ImmoCard({ immo }: { immo: DotationImmoRow }) {
  const statutConfig = {
    en_cours: { label: 'en cours', bg: '#EAF3DE', text: '#27500A' },
    complement: { label: 'complément', bg: '#FAEEDA', text: '#633806' },
    derniere: { label: 'dernière', bg: '#EAF3DE', text: '#27500A' },
    cedee: { label: 'cédée', bg: '#FCEBEB', text: '#791F1F' },
  }[immo.statut];

  const isPartialQuotePart = immo.quote_part_pro < 100;

  return (
    <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-md p-3 mb-2">
      <div className="flex justify-between items-start gap-3 mb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium truncate">{immo.designation}</p>
            {immo.is_reprise && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-medium">
                Reprise {immo.exercice_entree_neuronx}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Acquis le {formatDateFr(immo.date_acquisition)} · {immo.mode} {immo.duree} ans · base {formatEuro(immo.base_amortissable)}
          </p>
        </div>
        <span
          className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0"
          style={{ background: statutConfig.bg, color: statutConfig.text }}
        >
          {statutConfig.label}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="VNC début" value={formatEuro(immo.vnc_debut)} />
        <Stat label="Dotation brute" value={formatEuro(immo.dotation_brute)} />
        <Stat label="Quote-part" value={`${immo.quote_part_pro.toFixed(0)} %`} warning={isPartialQuotePart} />
        <Stat label="VNC fin" value={formatEuro(immo.vnc_fin)} success={immo.vnc_fin === 0} />
      </div>
    </div>
  );
}
```

`MetricCard`, `Stat`, `SkeletonLoader`, `EmptyState` : composants simples à créer inline.

### Étape 8 — Branchement dans `CategoryDetailDrawer`

**`frontend/src/components/analytics/CategoryDetailDrawer.tsx`** — tout au début du composant :

```tsx
const isVirtualDotation =
  category?.is_virtual === true && category?.categorie === 'Dotations aux amortissements';

if (isVirtualDotation) {
  return <DotationsVirtualDrawer year={year} onClose={onClose} />;
}
// ... rendu standard existant
```

Ne rien toucher d'autre.

---

## Tests manuels

1. **Sidebar sync** : changer année dans sidebar depuis une autre page → naviguer vers `/amortissements` → KPIs reflètent la nouvelle année.
2. **Mode linéaire masqué** : ouvrir `ImmobilisationDrawer` en création → aucun sélecteur mode, pavé readonly "Linéaire" avec tooltip.
3. **Config simplifiée** : section "Catégories éligibles" disparue, note info bleue au-dessus du seuil.
4. **Section Reprise repliée par défaut** : ouvrir `ImmobilisationDrawer` en création → checkbox "Reprise d'une immobilisation existante" visible mais non cochée, sous-champs cachés.
5. **Reprise — auto-calcul** : cocher la checkbox, saisir `date_acquisition: 2024-03-15, base: 4500, duree: 5, exerciceEntree: 2026` → après 400 ms de debounce, `amortAnterieurs ≈ 1662.50`, `vncOuverture ≈ 2837.50`. Badge "Cohérence validée" vert.
6. **Reprise — édition manuelle** : modifier `amortAnterieurs` à `1800` → VNC ouverture reste à 2837.50 → badge rouge "Incohérence : 1800 + 2837.50 = 4637.50 ≠ 4500". Ajuster VNC à `2700` → badge vert.
7. **Reprise — bouton recalcul** : après édition manuelle, bouton "Recalculer depuis la durée légale" apparaît. Clic → valeurs recalculées, bouton disparaît.
8. **Reprise — validation exercice** : saisir `exerciceEntree = 2024` (≤ année acquisition 2024) → option masquée dans le select (géré par la boucle de génération des options).
9. **Reprise — validation save** : bouton Enregistrer désactivé tant que badge rouge.
10. **Reprise — payload correct** : soumettre formulaire avec `isReprise=true` → payload POST contient `exercice_entree_neuronx`, `amortissements_anterieurs`, `vnc_ouverture`. Si `isReprise=false` (ou décoché) → ces 3 champs valent `null/0/null`.
11. **Registre — badge Reprise** : créer immo avec reprise → apparaît dans le registre avec badge ambre "Reprise 2026" à côté du nom.
12. **DotationsVirtualDrawer** : sur `/compta-analytique` avec dotations > 0 → ligne virtuelle avec badge "calculé", clic → drawer 650px avec cartes immos, dont celles en reprise marquées "Reprise 2026".
13. **Empty state** : année sans dotation → pas de ligne virtuelle, drawer inaccessible.
14. **CTA footer DotationsVirtualDrawer** : clic "Voir le registre ↗" → `/amortissements` avec la bonne année (store mis à jour).

## CLAUDE.md — à ajouter

```markdown
- **AmortissementsPage → useFiscalYearStore** : migrée (9ᵉ page utilisant le
  store global, après EditorPage/AlertesPage/CloturePage/ComptaAnalytique/
  Dashboard/Export/Reports/Previsionnel/Tasks).

- **ImmobilisationDrawer mode masqué** : sélecteur mode remplacé par pavé
  readonly "Linéaire" avec tooltip. `create_immobilisation` backend force
  aussi `mode = "lineaire"`. Immos legacy dégressives préservées en lecture.

- **ImmobilisationDrawer — section Reprise d'exercice antérieur** : checkbox
  "Reprise d'une immobilisation existante" (repliée par défaut) qui déplie 3
  inputs : exercice d'entrée (select années filtrées > année acquisition),
  cumul amortissements antérieurs, VNC d'ouverture. Auto-calcul via
  `POST /compute-backfill` avec debounce 400 ms quand les champs de base
  changent. Flag `backfillManuallyEdited` bascule à true quand l'utilisateur
  édite amort/VNC → affiche bouton "Recalculer depuis la durée légale" pour
  revenir au calcul auto. Validation temps réel : badge vert si
  `amort + vnc === base` (tolérance 1€), badge rouge sinon — bouton
  Enregistrer désactivé si incohérence. Note info bleue expliquant que les
  exercices antérieurs sont hors scope NeuronX. Section visible uniquement
  en mode création (pas en édition d'immo existante).

- **ConfigAmortissementsDrawer simplifié** : section "Catégories éligibles"
  supprimée (détection strict `Matériel` côté backend). Note info bleue
  au-dessus du seuil.

- **DotationsVirtualDrawer** (`components/analytics/DotationsVirtualDrawer.tsx`) :
  drawer 650px spécialisé pour la ligne virtuelle `Dotations aux amortissements`.
  `CategoryDetailDrawer` branche dessus quand `is_virtual === true`. Structure :
  header avec badge "calculé" violet, 3 MetricCards, bandeau info bleu, liste
  de cartes `ImmoCard` avec grid 4 colonnes + badge statut (en_cours vert /
  complément ambre / dernière vert / cédée rouge) + **badge "Reprise {year}"
  ambre** si `immo.is_reprise`. Footer avec CTA "Voir le registre ↗" qui
  met à jour `useFiscalYearStore.year` avant navigate.

- **Badge Reprise dans le registre** : les lignes du tableau Registre
  (`AmortissementsPage` onglet 1) affichent un badge ambre
  `Reprise {exercice_entree_neuronx}` à côté du nom si `immo.exercice_entree_neuronx !== null`.
  Tooltip : "Reprise depuis {year} — acquisition réelle {year_acq}".
```

## Commits suggérés

1. `feat(frontend): types + hooks amortissements (virtual-detail, dotation-ref, compute-backfill)`
2. `feat(frontend): AmortissementsPage → useFiscalYearStore + badge Reprise registre`
3. `feat(frontend): ImmobilisationDrawer mode linéaire verrouillé`
4. `feat(frontend): ImmobilisationDrawer section Reprise d'exercice antérieur`
5. `feat(frontend): ConfigAmortissementsDrawer simplifié`
6. `feat(frontend): DotationsVirtualDrawer + branchement CategoryDetailDrawer`
7. `docs: CLAUDE.md — frontend fiscal amortissements + reprise`
