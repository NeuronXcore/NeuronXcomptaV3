import { useState, useEffect } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'
import { cn, MOIS_FR } from '@/lib/utils'
import { useAddProvider, useUpdateProvider } from '@/hooks/usePrevisionnel'
import { useCategories } from '@/hooks/useApi'
import type { PrevProvider } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  provider?: PrevProvider | null
}

const PERIODICITE_MOIS: Record<string, number[]> = {
  mensuel: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  bimestriel: [1, 3, 5, 7, 9, 11],
  trimestriel: [1, 4, 7, 10],
  semestriel: [1, 7],
  annuel: [1],
}

export default function ProviderDrawer({ open, onClose, provider }: Props) {
  const isEdit = !!provider
  const [mode, setMode] = useState(provider?.mode || 'facture')
  const [fournisseur, setFournisseur] = useState(provider?.fournisseur || '')
  const [label, setLabel] = useState(provider?.label || '')
  const [periodicite, setPeriodicite] = useState(provider?.periodicite || 'mensuel')
  const [moisAttendus, setMoisAttendus] = useState<number[]>(provider?.mois_attendus || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const [jour, setJour] = useState(provider?.jour_attendu || 15)
  const [delai, setDelai] = useState(provider?.delai_retard_jours || 15)
  const [montant, setMontant] = useState<string>(provider?.montant_estime != null ? String(provider.montant_estime) : '')
  const [categorie, setCategorie] = useState(provider?.categorie || '')
  const [keywordsOcr, setKeywordsOcr] = useState<string[]>(provider?.keywords_ocr || [])
  const [keywordsOps, setKeywordsOps] = useState<string[]>(provider?.keywords_operations || [])
  const [tolerance, setTolerance] = useState(provider?.tolerance_montant || 5)
  const [actif, setActif] = useState(provider?.actif ?? true)
  const [kwInput, setKwInput] = useState('')
  const [kwOpsInput, setKwOpsInput] = useState('')

  const { data: catData } = useCategories()
  const addMut = useAddProvider()
  const updateMut = useUpdateProvider()

  useEffect(() => {
    if (provider) {
      setMode(provider.mode)
      setFournisseur(provider.fournisseur)
      setLabel(provider.label)
      setPeriodicite(provider.periodicite)
      setMoisAttendus(provider.mois_attendus)
      setJour(provider.jour_attendu)
      setDelai(provider.delai_retard_jours)
      setMontant(provider.montant_estime != null ? String(provider.montant_estime) : '')
      setCategorie(provider.categorie || '')
      setKeywordsOcr(provider.keywords_ocr)
      setKeywordsOps(provider.keywords_operations)
      setTolerance(provider.tolerance_montant)
      setActif(provider.actif)
    }
  }, [provider?.id])

  useEffect(() => {
    if (mode !== 'echeancier') {
      setMoisAttendus(PERIODICITE_MOIS[periodicite] || [])
    }
  }, [periodicite, mode])

  const handleSave = () => {
    const data = {
      fournisseur, label, mode, periodicite,
      mois_attendus: mode === 'echeancier' ? [1] : moisAttendus,
      jour_attendu: jour,
      delai_retard_jours: delai,
      montant_estime: montant ? parseFloat(montant) : null,
      categorie: categorie || null,
      keywords_ocr: keywordsOcr,
      keywords_operations: keywordsOps,
      tolerance_montant: tolerance,
      actif,
    }
    if (isEdit && provider) {
      updateMut.mutate({ id: provider.id, data }, { onSuccess: onClose })
    } else {
      addMut.mutate(data, { onSuccess: onClose })
    }
  }

  const isPending = addMut.isPending || updateMut.isPending

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="px-5 py-4 border-b border-border shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">{isEdit ? 'Modifier' : 'Ajouter'} un fournisseur</h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Mode */}
          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'facture' | 'echeancier')} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text">
              <option value="facture">Facture récurrente</option>
              <option value="echeancier">Échéancier de prélèvements</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Fournisseur *</label>
              <input value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Label *</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text" />
            </div>
          </div>

          {mode !== 'echeancier' && (
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Périodicité</label>
              <select value={periodicite} onChange={(e) => setPeriodicite(e.target.value as 'mensuel' | 'bimestriel' | 'trimestriel' | 'semestriel' | 'annuel')} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text">
                <option value="mensuel">Mensuel</option>
                <option value="bimestriel">Bimestriel</option>
                <option value="trimestriel">Trimestriel</option>
                <option value="semestriel">Semestriel</option>
                <option value="annuel">Annuel</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Jour du mois</label>
              <input type="number" min={1} max={28} value={jour} onChange={(e) => setJour(parseInt(e.target.value) || 15)} className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Délai retard (j)</label>
              <input type="number" value={delai} onChange={(e) => setDelai(parseInt(e.target.value) || 15)} className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Montant estimé</label>
              <input type="number" step="0.01" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="optionnel" className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text" />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Catégorie</label>
            <select value={categorie} onChange={(e) => setCategorie(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text">
              <option value="">—</option>
              {catData?.categories?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          {/* Keywords OCR */}
          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Keywords OCR</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {keywordsOcr.map((k) => (
                <span key={k} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-primary/15 text-primary rounded text-[10px]">
                  {k}
                  <button onClick={() => setKeywordsOcr(keywordsOcr.filter((x) => x !== k))}><X size={8} /></button>
                </span>
              ))}
            </div>
            <input
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && kwInput.trim()) { setKeywordsOcr([...keywordsOcr, kwInput.trim()]); setKwInput('') } }}
              placeholder="Entrée pour ajouter..."
              className="w-full bg-surface border border-border rounded-md px-2.5 py-1 text-xs text-text"
            />
          </div>

          {/* Mode echeancier */}
          {mode === 'echeancier' && (
            <>
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">Keywords opérations bancaires</label>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {keywordsOps.map((k) => (
                    <span key={k} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-500/15 text-blue-400 rounded text-[10px]">
                      {k}
                      <button onClick={() => setKeywordsOps(keywordsOps.filter((x) => x !== k))}><X size={8} /></button>
                    </span>
                  ))}
                </div>
                <input
                  value={kwOpsInput}
                  onChange={(e) => setKwOpsInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && kwOpsInput.trim()) { setKeywordsOps([...keywordsOps, kwOpsInput.trim()]); setKwOpsInput('') } }}
                  placeholder="Entrée pour ajouter..."
                  className="w-full bg-surface border border-border rounded-md px-2.5 py-1 text-xs text-text"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted mb-1 block">Tolérance montant (EUR)</label>
                <input type="number" step="0.5" value={tolerance} onChange={(e) => setTolerance(parseFloat(e.target.value) || 5)} className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text" />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
            <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} className="accent-primary" />
            Actif
          </label>
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg text-text-muted hover:text-text">Annuler</button>
          <button
            onClick={handleSave}
            disabled={!fournisseur || !label || isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </div>
    </>
  )
}
