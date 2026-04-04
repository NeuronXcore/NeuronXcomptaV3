import { useState, useEffect, useMemo } from 'react'
import { X, Landmark, Save, Loader2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { calcTableauAmortissement } from '@/lib/amortissement-engine'
import { useCreateImmobilisation, useUpdateImmobilisation, useImmobiliserCandidate } from '@/hooks/useAmortissements'
import { useGedPostes } from '@/hooks/useGed'
import type { Immobilisation, AmortissementCandidate, LigneAmortissement } from '@/types'

interface ImmobilisationDrawerProps {
  isOpen: boolean
  onClose: () => void
  immobilisation?: Immobilisation | null
  candidate?: AmortissementCandidate | null
}

const PLAFONDS_VEHICULE = [
  { label: 'Électrique (≤ 20g CO2)', plafond: 30000 },
  { label: 'Hybride (20-50g CO2)', plafond: 20300 },
  { label: 'Standard (50-130g CO2)', plafond: 18300 },
  { label: 'Polluant (> 130g CO2)', plafond: 9900 },
]

export default function ImmobilisationDrawer({ isOpen, onClose, immobilisation, candidate }: ImmobilisationDrawerProps) {
  const { data: postesConfig } = useGedPostes()
  const createMutation = useCreateImmobilisation()
  const updateMutation = useUpdateImmobilisation()
  const immobiliserMutation = useImmobiliserCandidate()

  const isEdit = !!immobilisation
  const isCandidate = !!candidate

  const [libelle, setLibelle] = useState('')
  const [dateAcq, setDateAcq] = useState('')
  const [valeur, setValeur] = useState(0)
  const [duree, setDuree] = useState(5)
  const [methode, setMethode] = useState<'lineaire' | 'degressif'>('lineaire')
  const [poste, setPoste] = useState('')
  const [dateMes, setDateMes] = useState('')
  const [quotePart, setQuotePart] = useState(100)
  const [co2, setCo2] = useState('')
  const [plafond, setPlafond] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (immobilisation) {
      setLibelle(immobilisation.libelle)
      setDateAcq(immobilisation.date_acquisition)
      setValeur(immobilisation.valeur_origine)
      setDuree(immobilisation.duree_amortissement)
      setMethode(immobilisation.methode)
      setPoste(immobilisation.poste_comptable)
      setDateMes(immobilisation.date_mise_en_service || '')
      setQuotePart(immobilisation.quote_part_pro)
      setCo2(immobilisation.co2_classe || '')
      setPlafond(immobilisation.plafond_fiscal)
      setNotes(immobilisation.notes || '')
    } else if (candidate) {
      setLibelle(candidate.libelle)
      setDateAcq(candidate.date)
      setValeur(candidate.debit)
      setDuree(5)
      setMethode('lineaire')
      setPoste('')
      setDateMes(candidate.date)
      setQuotePart(100)
      setCo2('')
      setPlafond(null)
      setNotes('')
    } else {
      setLibelle(''); setDateAcq(''); setValeur(0); setDuree(5)
      setMethode('lineaire'); setPoste(''); setDateMes(''); setQuotePart(100)
      setCo2(''); setPlafond(null); setNotes('')
    }
  }, [immobilisation?.id, candidate?.index, isOpen])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Realtime tableau preview
  const tableau = useMemo<LigneAmortissement[]>(() => {
    if (!dateAcq || valeur <= 0 || duree <= 0) return []
    return calcTableauAmortissement({
      valeur_origine: valeur,
      duree,
      methode,
      date_mise_en_service: dateMes || dateAcq,
      quote_part_pro: quotePart,
      plafond_fiscal: plafond,
    })
  }, [valeur, duree, methode, dateAcq, dateMes, quotePart, plafond])

  const currentYear = new Date().getFullYear()

  const handleSubmit = () => {
    const data = {
      libelle, date_acquisition: dateAcq, valeur_origine: valeur,
      duree_amortissement: duree, methode, poste_comptable: poste,
      date_mise_en_service: dateMes || null, quote_part_pro: quotePart,
      plafond_fiscal: plafond, co2_classe: co2 || null, notes: notes || null,
      operation_source: candidate ? { file: candidate.filename, index: candidate.index } : null,
    }

    if (isCandidate) {
      immobiliserMutation.mutate(data, { onSuccess: () => onClose() })
    } else if (isEdit && immobilisation) {
      updateMutation.mutate({ id: immobilisation.id, data }, { onSuccess: () => onClose() })
    } else {
      createMutation.mutate(data, { onSuccess: () => onClose() })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending || immobiliserMutation.isPending

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[650px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Landmark size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">
                {isEdit ? 'Modifier l\'immobilisation' : isCandidate ? 'Immobiliser l\'opération' : 'Nouvelle immobilisation'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Form */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] text-text-muted block mb-1">Libellé</label>
              <input type="text" value={libelle} onChange={e => setLibelle(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Date d'acquisition</label>
              <input type="date" value={dateAcq} onChange={e => setDateAcq(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Valeur d'origine</label>
              <input type="number" step="0.01" value={valeur || ''} onChange={e => setValeur(parseFloat(e.target.value) || 0)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Poste comptable</label>
              <select value={poste} onChange={e => setPoste(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
                <option value="">Sélectionner...</option>
                {(postesConfig?.postes ?? []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Durée (années)</label>
              <select value={duree} onChange={e => setDuree(parseInt(e.target.value))}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
                {[1, 3, 5, 7, 10].map(d => <option key={d} value={d}>{d} ans</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Méthode</label>
              <select value={methode} onChange={e => setMethode(e.target.value as 'lineaire' | 'degressif')}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
                <option value="lineaire">Linéaire</option>
                <option value="degressif">Dégressif</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Mise en service</label>
              <input type="date" value={dateMes} onChange={e => setDateMes(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
          </div>

          {/* Usage pro slider */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Usage professionnel : {quotePart}%</label>
            <input type="range" min={0} max={100} step={5} value={quotePart}
              onChange={e => setQuotePart(parseInt(e.target.value))}
              className="w-full accent-primary" />
          </div>

          {/* Vehicle section */}
          {poste === 'vehicule' && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <h4 className="text-xs font-semibold text-text">Véhicule — Plafond fiscal</h4>
              <select value={co2} onChange={e => {
                setCo2(e.target.value)
                const found = PLAFONDS_VEHICULE.find(p => p.label === e.target.value)
                setPlafond(found?.plafond ?? 18300)
              }} className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
                <option value="">Sélectionner classe CO2...</option>
                {PLAFONDS_VEHICULE.map(p => <option key={p.label} value={p.label}>{p.label} — {formatCurrency(p.plafond)}</option>)}
              </select>
              {plafond && <p className="text-xs text-text-muted">Base amortissable plafonnée à {formatCurrency(plafond)}</p>}
            </div>
          )}

          {/* Realtime tableau preview */}
          {tableau.length > 0 && (
            <div className="bg-surface rounded-lg border border-border p-4">
              <h4 className="text-xs font-semibold text-text mb-2">Aperçu tableau d'amortissement</h4>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-text-muted border-b border-border">
                    <th className="text-left py-1">Exercice</th>
                    <th className="text-right py-1">Dot. brute</th>
                    <th className="text-right py-1">Déduc. ({quotePart}%)</th>
                    <th className="text-right py-1">Cumul</th>
                    <th className="text-right py-1">VNC</th>
                  </tr>
                </thead>
                <tbody>
                  {tableau.map(l => (
                    <tr key={l.exercice} className={cn('border-b border-border/50', l.exercice === currentYear && 'bg-primary/5')}>
                      <td className="py-1 text-text">{l.exercice}</td>
                      <td className="py-1 text-right">{formatCurrency(l.dotation_brute)}</td>
                      <td className="py-1 text-right text-emerald-400">{formatCurrency(l.dotation_deductible)}</td>
                      <td className="py-1 text-right text-text-muted">{formatCurrency(l.amortissements_cumules)}</td>
                      <td className="py-1 text-right font-medium">{formatCurrency(l.vnc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary resize-none" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text">Annuler</button>
          <button onClick={handleSubmit} disabled={isPending || !libelle || !dateAcq || valeur <= 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50">
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isCandidate ? "Confirmer l'immobilisation" : isEdit ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </>
  )
}
