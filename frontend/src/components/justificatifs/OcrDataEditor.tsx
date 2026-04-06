import { useState, useMemo, useEffect } from 'react'
import { FileSearch, Save } from 'lucide-react'
import { useUpdateOcrData } from '@/hooks/useOcr'
import { formatCurrency, cn } from '@/lib/utils'

interface OcrDataEditorProps {
  filename: string
  currentData: {
    best_amount: number | null
    best_date: string | null
    supplier: string | null
    amounts: number[]
    dates: string[]
  }
  isManualEdit?: boolean
  onUpdated?: () => void
}

export default function OcrDataEditor({ filename, currentData, isManualEdit, onUpdated }: OcrDataEditorProps) {
  const updateMutation = useUpdateOcrData()

  const [selectedAmount, setSelectedAmount] = useState<number | null>(currentData.best_amount)
  const [manualAmount, setManualAmount] = useState('')
  const [useManualAmount, setUseManualAmount] = useState(false)

  const [selectedDate, setSelectedDate] = useState<string | null>(currentData.best_date)
  const [manualDate, setManualDate] = useState('')
  const [useManualDate, setUseManualDate] = useState(false)

  const [supplier, setSupplier] = useState(currentData.supplier || '')

  // Reset state when data changes
  useEffect(() => {
    setSelectedAmount(currentData.best_amount)
    setManualAmount('')
    setUseManualAmount(false)
    setSelectedDate(currentData.best_date)
    setManualDate('')
    setUseManualDate(false)
    setSupplier(currentData.supplier || '')
  }, [currentData.best_amount, currentData.best_date, currentData.supplier])

  // Filter dates: exclude dates before 2020 or after today + 1 year
  const filteredDates = useMemo(() => {
    const now = new Date()
    const maxDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
    return currentData.dates.filter(d => {
      const parsed = new Date(d)
      return parsed.getFullYear() >= 2020 && parsed <= maxDate
    })
  }, [currentData.dates])

  const formatDateDisplay = (isoDate: string): string => {
    const parts = isoDate.split('-')
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
    return isoDate
  }

  const effectiveAmount = useManualAmount ? parseFloat(manualAmount) || null : selectedAmount
  const effectiveDate = useManualDate ? manualDate : selectedDate

  const hasChanges = useMemo(() => {
    if (effectiveAmount !== currentData.best_amount) return true
    if (effectiveDate !== currentData.best_date) return true
    if (supplier !== (currentData.supplier || '')) return true
    return false
  }, [effectiveAmount, effectiveDate, supplier, currentData])

  const handleSave = () => {
    const data: Record<string, unknown> = {}
    if (effectiveAmount !== currentData.best_amount && effectiveAmount !== null) {
      data.best_amount = effectiveAmount
    }
    if (effectiveDate !== currentData.best_date && effectiveDate) {
      data.best_date = effectiveDate
    }
    if (supplier !== (currentData.supplier || '')) {
      data.supplier = supplier
    }
    if (Object.keys(data).length === 0) return

    updateMutation.mutate(
      { filename, data },
      { onSuccess: () => onUpdated?.() }
    )
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4 mt-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold flex items-center gap-1.5 text-text">
          <FileSearch size={14} className="text-primary" />
          Donnees extraites
        </h4>
        <span className={cn(
          'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
          isManualEdit
            ? 'bg-amber-500/15 text-amber-400'
            : 'bg-blue-500/15 text-blue-400'
        )}>
          {isManualEdit ? 'Manuel' : 'OCR'}
        </span>
      </div>

      {/* Montant TTC */}
      <div className="flex items-start gap-3 mb-3">
        <span className="text-text-muted text-sm w-28 shrink-0 pt-1">Montant TTC</span>
        <div className="flex-1">
          {currentData.amounts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {currentData.amounts.map((amt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedAmount(amt)
                    setUseManualAmount(false)
                    setManualAmount('')
                  }}
                  className={cn(
                    'px-3 py-1 rounded-full text-sm cursor-pointer border transition-colors',
                    !useManualAmount && selectedAmount === amt
                      ? 'bg-primary text-white border-primary'
                      : 'border-border text-text hover:border-primary'
                  )}
                >
                  {formatCurrency(amt)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted mb-2">Aucun montant detecte</p>
          )}
          <input
            type="number"
            step="0.01"
            placeholder="Autre montant"
            value={manualAmount}
            onChange={e => {
              setManualAmount(e.target.value)
              setUseManualAmount(true)
              setSelectedAmount(null)
            }}
            className="bg-background border border-border rounded px-3 py-1.5 text-sm text-text w-40"
          />
        </div>
      </div>

      {/* Date facture */}
      <div className="flex items-start gap-3 mb-3">
        <span className="text-text-muted text-sm w-28 shrink-0 pt-1">Date facture</span>
        <div className="flex-1">
          {filteredDates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {filteredDates.map((d, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedDate(d)
                    setUseManualDate(false)
                    setManualDate('')
                  }}
                  className={cn(
                    'px-3 py-1 rounded-full text-sm cursor-pointer border transition-colors',
                    !useManualDate && selectedDate === d
                      ? 'bg-primary text-white border-primary'
                      : 'border-border text-text hover:border-primary'
                  )}
                >
                  {formatDateDisplay(d)}
                </button>
              ))}
            </div>
          )}
          <input
            type="date"
            value={manualDate}
            onChange={e => {
              setManualDate(e.target.value)
              setUseManualDate(true)
              setSelectedDate(null)
            }}
            className="bg-background border border-border rounded px-3 py-1.5 text-sm text-text"
          />
        </div>
      </div>

      {/* Fournisseur */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-text-muted text-sm w-28 shrink-0">Fournisseur</span>
        <input
          type="text"
          value={supplier}
          onChange={e => setSupplier(e.target.value)}
          placeholder="Nom du fournisseur"
          className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm text-text"
        />
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Save size={14} />
          {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
