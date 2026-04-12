import React, { useState, useRef, useEffect } from 'react'
import { Zap, Check, X, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatCurrency } from '@/lib/utils'
import { useUrssafDeductible, usePatchCsgSplit } from '@/hooks/useSimulation'
import type { Operation, UrssafDeductibleResult } from '@/types'

interface UrssafSplitWidgetProps {
  op: Operation
  filename: string
  index: number
  year: number
  bnc_estime: number
  onSplitSaved: () => void
}

export function isUrssafOp(op: Operation): boolean {
  const libelle = (op['Libellé'] || '').toLowerCase()
  const cat = (op['Catégorie'] || '').toLowerCase()
  const sous = (op['Sous-catégorie'] || '').toLowerCase()
  return (
    libelle.includes('urssaf') ||
    libelle.includes('dspamc') ||
    libelle.includes('cotis') ||
    (cat.includes('cotisations') && sous.includes('urssaf'))
  )
}

export default function UrssafSplitWidget({ op, filename, index, year, bnc_estime, onSplitSaved }: UrssafSplitWidgetProps) {
  const [showPopover, setShowPopover] = useState(false)
  const [result, setResult] = useState<UrssafDeductibleResult | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const computeMutation = useUrssafDeductible()
  const patchMutation = usePatchCsgSplit(filename, index)

  const existingCsgNd = op.csg_non_deductible

  // Close popover on outside click
  useEffect(() => {
    if (!showPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopover])

  const handleCompute = async () => {
    const montant = Math.abs(op['Débit'] || 0)
    if (!montant) {
      toast.error('Montant manquant')
      return
    }
    try {
      const res = await computeMutation.mutateAsync({
        montant_brut: montant,
        bnc_estime: Math.abs(bnc_estime) || 50000,
        year,
      })
      setResult(res)
      setShowPopover(true)
    } catch {
      toast.error('Erreur de calcul CSG/CRDS')
    }
  }

  const handleApply = async () => {
    if (!result) return
    try {
      await patchMutation.mutateAsync(result.part_non_deductible)
      toast.success(`CSG/CRDS non déductible : ${formatCurrency(result.part_non_deductible)}`)
      setShowPopover(false)
      setResult(null)
      onSplitSaved()
    } catch {
      toast.error('Erreur lors de l\'enregistrement')
    }
  }

  const handleCancel = () => {
    setShowPopover(false)
    setResult(null)
  }

  // Badge si déjà calculé
  if (existingCsgNd && existingCsgNd > 0 && !showPopover) {
    return (
      <button
        onClick={handleCompute}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
        title={`CSG/CRDS non déductible : ${formatCurrency(existingCsgNd)} — Cliquer pour recalculer`}
      >
        {formatCurrency(existingCsgNd)} nd
      </button>
    )
  }

  return (
    <div className="relative inline-flex">
      {/* Bouton Calculer */}
      {!showPopover && (
        <button
          onClick={handleCompute}
          disabled={computeMutation.isPending}
          className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
            'bg-primary/10 text-primary hover:bg-primary/20',
            computeMutation.isPending && 'opacity-50 cursor-wait'
          )}
          title="Calculer le split CSG/CRDS déductible"
        >
          <Zap size={10} />
          CSG
        </button>
      )}

      {/* Popover résultat */}
      {showPopover && result && (
        <div
          ref={popoverRef}
          className="absolute z-50 top-full right-0 mt-1 w-72 bg-surface border border-border rounded-lg shadow-xl p-3 text-xs"
        >
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Cotisation brute</span>
              <span className="font-medium text-text">{formatCurrency(result.montant_brut)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">├── Part déductible</span>
              <span className="font-medium text-success">{formatCurrency(result.part_deductible)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">└── CSG/CRDS non déd.</span>
              <span className="font-medium text-danger">{formatCurrency(result.part_non_deductible)}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between items-center">
              <span className="text-text-muted flex items-center gap-1">
                Assiette estimée
                <span
                  className="cursor-help"
                  title={result.assiette_mode === 'bnc_abattu'
                    ? 'Réforme 2025 : BNC × 74%'
                    : 'BNC + cotisations sociales estimées'}
                >
                  <Info size={10} className="text-text-muted" />
                </span>
              </span>
              <span className="text-text">
                {formatCurrency(result.assiette_csg_crds)}
                {result.assiette_mode === 'bnc_abattu' && (
                  <span className="text-text-muted ml-1">(BNC × 74%)</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-border">
            <button
              onClick={handleCancel}
              className="px-2 py-1 text-[10px] rounded text-text-muted hover:bg-surface-hover transition-colors"
            >
              <X size={10} className="inline mr-0.5" />
              Annuler
            </button>
            <button
              onClick={handleApply}
              disabled={patchMutation.isPending}
              className={cn(
                'px-2 py-1 text-[10px] rounded font-medium transition-colors',
                'bg-primary text-white hover:bg-primary/90',
                patchMutation.isPending && 'opacity-50 cursor-wait'
              )}
            >
              <Check size={10} className="inline mr-0.5" />
              Appliquer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
