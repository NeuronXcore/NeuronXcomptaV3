import { useState, useMemo, useEffect } from 'react'
import { X, Plus, Trash2, Scissors } from 'lucide-react'
import { useSetVentilation, useRemoveVentilation } from '@/hooks/useVentilation'
import { useCategories } from '@/hooks/useApi'
import { formatCurrency, cn } from '@/lib/utils'
import type { Operation, VentilationLine, CategoryRaw } from '@/types'
import toast from 'react-hot-toast'

interface VentilationDrawerProps {
  open: boolean
  onClose: () => void
  filename: string | null
  opIndex: number | null
  operation: Operation | null
}

interface LineState {
  montant: string
  categorie: string
  sous_categorie: string
  libelle: string
}

export default function VentilationDrawer({ open, onClose, filename, opIndex, operation }: VentilationDrawerProps) {
  const { data: categoriesData } = useCategories()
  const setVentilation = useSetVentilation(filename)
  const removeVentilation = useRemoveVentilation(filename)

  const [lines, setLines] = useState<LineState[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const montantOp = useMemo(() => {
    if (!operation) return 0
    return Math.max(operation['Débit'] || 0, operation['Crédit'] || 0)
  }, [operation])

  const isAlreadyVentilated = (operation?.ventilation?.length ?? 0) > 0

  // Initialize lines on open
  useEffect(() => {
    if (!open || !operation) return
    setConfirmDelete(false)

    if (operation.ventilation && operation.ventilation.length > 0) {
      setLines(operation.ventilation.map(vl => ({
        montant: vl.montant.toFixed(2),
        categorie: vl.categorie,
        sous_categorie: vl.sous_categorie,
        libelle: vl.libelle,
      })))
    } else {
      setLines([
        { montant: montantOp.toFixed(2), categorie: '', sous_categorie: '', libelle: '' },
        { montant: '0.00', categorie: '', sous_categorie: '', libelle: '' },
      ])
    }
  }, [open, operation, montantOp])

  const categoryNames = useMemo(() => {
    if (!categoriesData) return []
    return [...new Set(categoriesData.raw.map((c: CategoryRaw) => c['Catégorie']))].filter(Boolean).sort()
  }, [categoriesData])

  const subcategoriesMap = useMemo(() => {
    if (!categoriesData) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const c of categoriesData.raw) {
      const cat = c['Catégorie']
      const sub = c['Sous-catégorie']
      if (cat && sub && sub !== 'null') {
        if (!map.has(cat)) map.set(cat, [])
        const list = map.get(cat)!
        if (!list.includes(sub)) list.push(sub)
      }
    }
    for (const [, list] of map) list.sort()
    return map
  }, [categoriesData])

  const totalLines = useMemo(() => {
    return lines.reduce((sum, l) => sum + (parseFloat(l.montant) || 0), 0)
  }, [lines])

  const reste = montantOp - totalLines
  const isBalanced = Math.abs(reste) <= 0.01
  const canValidate = isBalanced && lines.length >= 2

  const updateLine = (idx: number, field: keyof LineState, value: string) => {
    setLines(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      if (field === 'categorie') {
        updated[idx].sous_categorie = ''
      }
      return updated
    })
  }

  const removeLine = (idx: number) => {
    if (lines.length <= 2) return
    setLines(prev => prev.filter((_, i) => i !== idx))
  }

  const addLine = () => {
    setLines(prev => [...prev, { montant: '0.00', categorie: '', sous_categorie: '', libelle: '' }])
  }

  const handleValidate = () => {
    if (!filename || opIndex === null) return
    const payload: Omit<VentilationLine, 'index'>[] = lines.map(l => ({
      index: 0,
      montant: parseFloat(l.montant) || 0,
      categorie: l.categorie,
      sous_categorie: l.sous_categorie,
      libelle: l.libelle,
      justificatif: null,
      lettre: false,
    }))
    setVentilation.mutate(
      { opIndex, lines: payload },
      {
        onSuccess: () => {
          toast.success('Ventilation enregistree')
          onClose()
        },
        onError: (err) => toast.error(err.message),
      }
    )
  }

  const handleDelete = () => {
    if (!filename || opIndex === null) return
    removeVentilation.mutate(opIndex, {
      onSuccess: () => {
        toast.success('Ventilation supprimee')
        onClose()
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[600px] bg-background border-l border-border z-50',
          'transform transition-transform duration-300 ease-out flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Scissors size={18} className="text-primary shrink-0" />
              <h2 className="font-semibold text-lg truncate">Ventilation</h2>
            </div>
            {operation && (
              <p className="text-sm text-text-muted truncate">{operation['Libellé']}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="bg-primary/10 text-primary font-mono text-sm px-2 py-0.5 rounded">
              {formatCurrency(montantOp)}
            </span>
            <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Balance bar */}
        <div className={cn(
          'px-4 py-2 text-sm font-medium border-b border-border',
          isBalanced ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        )}>
          {isBalanced
            ? 'Ventilation equilibree'
            : `Reste a ventiler : ${formatCurrency(Math.abs(reste))} ${reste > 0 ? '(manquant)' : '(excedent)'}`
          }
        </div>

        {/* Lines */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {lines.map((line, idx) => (
            <div key={idx} className="bg-surface rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted font-medium">Ligne {idx + 1}</span>
                <button
                  onClick={() => removeLine(idx)}
                  disabled={lines.length <= 2}
                  className="text-text-muted hover:text-danger disabled:opacity-30 p-0.5 rounded"
                  title="Supprimer la ligne"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Montant + Libelle */}
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <div>
                  <label className="text-[10px] text-text-muted uppercase">Montant</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.montant}
                    onChange={e => updateLine(idx, 'montant', e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted uppercase">Libelle</label>
                  <input
                    type="text"
                    value={line.libelle}
                    onChange={e => updateLine(idx, 'libelle', e.target.value)}
                    placeholder="Description..."
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                  />
                </div>
              </div>

              {/* Categorie + Sous-categorie */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-text-muted uppercase">Categorie</label>
                  <select
                    value={line.categorie}
                    onChange={e => updateLine(idx, 'categorie', e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                  >
                    <option value="">--</option>
                    {categoryNames.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-text-muted uppercase">Sous-categorie</label>
                  <select
                    value={line.sous_categorie}
                    onChange={e => updateLine(idx, 'sous_categorie', e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                    disabled={!line.categorie || !subcategoriesMap.has(line.categorie)}
                  >
                    <option value="">--</option>
                    {(subcategoriesMap.get(line.categorie) ?? []).map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addLine}
            className="w-full py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={14} /> Ajouter une ligne
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-2">
          {isAlreadyVentilated && (
            <div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-danger">Confirmer la suppression ?</span>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1 bg-danger text-white rounded text-sm hover:bg-danger/90"
                  >
                    Supprimer
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1 bg-surface border border-border rounded text-sm hover:bg-surface-hover"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-sm text-danger hover:text-danger/80 underline"
                >
                  Supprimer la ventilation
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-surface-hover"
            >
              Annuler
            </button>
            <button
              onClick={handleValidate}
              disabled={!canValidate || setVentilation.isPending}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {setVentilation.isPending ? 'Enregistrement...' : 'Valider'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
