import { useEffect, useMemo, useState } from 'react'
import {
  X,
  FileText,
  Loader2,
  Save,
  ArrowRight,
  Maximize2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatCurrency, buildConventionFilename } from '@/lib/utils'
import { useCategories } from '@/hooks/useApi'
import { useOperationFiles, useYearOperations } from '@/hooks/useOperations'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useManualAssociate } from '@/hooks/useRapprochement'
import { useUpdateOcrData } from '@/hooks/useOcr'
import { useRenameJustificatif } from '@/hooks/useJustificatifs'
import { useQueryClient } from '@tanstack/react-query'
import PreviewSubDrawer from './PreviewSubDrawer'
import type { CategoryRaw, Operation, OCRHistoryItem } from '@/types'

interface Props {
  open: boolean
  item: OCRHistoryItem | null
  onClose: () => void
}

/**
 * Drawer d'édition des données OCR d'un item de l'historique OCR.
 *
 * Réutilise le même éditeur compact que `SkippedItemEditor` dans
 * `ScanRenameDrawer` (supplier / date / montant + cat / sous-cat + op selector)
 * mais accessible depuis une ligne quelconque de `HistoriqueTab`, pas seulement
 * les items "skipped" du scan-rename.
 *
 * Flow :
 * 1. Clic sur Edit dans une ligne de l'historique → ouvre ce drawer pré-rempli
 * 2. Correction des données OCR → clic "Enregistrer" → PATCH ocr
 * 3. Si op sélectionnée → rename canonique + associate en chaîne
 * 4. Fermeture auto après succès
 */
export default function OcrEditDrawer({ open, item, onClose }: Props) {
  const queryClient = useQueryClient()

  // ── OCR data editing ──
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [manualAmount, setManualAmount] = useState('')
  const [useManualAmount, setUseManualAmount] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [manualDate, setManualDate] = useState('')
  const [useManualDate, setUseManualDate] = useState(false)
  const [supplier, setSupplier] = useState('')

  // ── Cat / sous-cat (filtre op selector) ──
  const [catFilter, setCatFilter] = useState('')
  const [subCatFilter, setSubCatFilter] = useState('')

  // ── Op cible ──
  const [selectedOpKey, setSelectedOpKey] = useState<string>('')

  // ── Sub-drawer preview PDF grand format ──
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)

  // Reset state when item changes
  useEffect(() => {
    if (!item) return
    setSelectedAmount(item.best_amount ?? null)
    setManualAmount('')
    setUseManualAmount(false)
    setSelectedDate(item.best_date ?? null)
    setManualDate('')
    setUseManualDate(false)
    setSupplier(item.supplier || '')
    // Initialiser les hints cat/sous-cat depuis le .ocr.json s'ils ont été saisis
    // précédemment. Sinon vide (l'utilisateur peut les définir pour aider le filtrage).
    setCatFilter(item.category_hint || '')
    setSubCatFilter(item.sous_categorie_hint || '')
    setSelectedOpKey('')
    setPreviewFilename(null)
  }, [item])

  // Reset preview when main drawer closes
  useEffect(() => {
    if (!open) setPreviewFilename(null)
  }, [open])

  // Esc handler pour le sub-drawer (ferme le sub, pas le main)
  useEffect(() => {
    if (!previewFilename) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPreviewFilename(null)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [previewFilename])

  // Esc closes main drawer — mais uniquement si le sub-drawer preview est fermé
  // (sinon le sub-drawer handler avec { capture: true } intercepte Esc en premier).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewFilename) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, previewFilename])

  // Hooks data
  const { data: categoriesData } = useCategories()
  const { selectedYear } = useFiscalYearStore()
  const { data: files = [] } = useOperationFiles()
  const monthsForYear = useMemo(
    () => files.filter((f) => f.year === selectedYear),
    [files, selectedYear],
  )
  const { data: yearOps } = useYearOperations(monthsForYear, open)

  // Hooks mutations
  const updateOcrMutation = useUpdateOcrData()
  const associateMutation = useManualAssociate()
  const renameMutation = useRenameJustificatif()

  // Dates/amounts filtrées (cohérent avec OcrDataEditor)
  const filteredDates = useMemo(() => {
    if (!item) return []
    const now = new Date()
    const maxDate = new Date(
      now.getFullYear() + 1,
      now.getMonth(),
      now.getDate(),
    )
    return (item.dates_found || []).filter((d) => {
      const parsed = new Date(d)
      return parsed.getFullYear() >= 2020 && parsed <= maxDate
    })
  }, [item])

  const amountCandidates = item?.amounts_found || []

  // Effective values
  const effectiveAmount = useManualAmount
    ? parseFloat(manualAmount) || null
    : selectedAmount
  const effectiveDate = useManualDate ? manualDate : selectedDate

  const hasOcrChanges = useMemo(() => {
    if (!item) return false
    if (effectiveAmount !== (item.best_amount ?? null)) return true
    if (effectiveDate !== (item.best_date ?? null)) return true
    if (supplier !== (item.supplier || '')) return true
    return false
  }, [effectiveAmount, effectiveDate, supplier, item])

  // Changements des hints cat/sous-cat (persistés au top-level du .ocr.json)
  const hasHintChanges = useMemo(() => {
    if (!item) return false
    if (catFilter !== (item.category_hint || '')) return true
    if (subCatFilter !== (item.sous_categorie_hint || '')) return true
    return false
  }, [catFilter, subCatFilter, item])

  // Catégories dérivées
  const categoryNames = useMemo(() => {
    if (!categoriesData) return []
    return [
      ...new Set(
        categoriesData.raw.map((c: CategoryRaw) => c['Catégorie']),
      ),
    ]
      .filter(Boolean)
      .sort()
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

  // Opérations candidates (ops sans justificatif, filtrées par cat/sous-cat si défini)
  interface EnrichedOp extends Operation {
    _originalIndex: number
    _filename: string
  }

  const opCandidates = useMemo<EnrichedOp[]>(() => {
    if (!yearOps) return []
    const byFile = new Map<string, number>()
    const enriched: EnrichedOp[] = yearOps.map((op) => {
      const fname = op._sourceFile ?? ''
      const idx = byFile.get(fname) ?? 0
      byFile.set(fname, idx + 1)
      return { ...op, _originalIndex: idx, _filename: fname } as EnrichedOp
    })
    return enriched
      .filter((op) => !op['Lien justificatif'])
      .filter((op) => !catFilter || op['Catégorie'] === catFilter)
      .filter(
        (op) =>
          !subCatFilter ||
          !catFilter ||
          op['Sous-catégorie'] === subCatFilter,
      )
      .slice(0, 50)
  }, [yearOps, catFilter, subCatFilter])

  const isSaving =
    updateOcrMutation.isPending ||
    renameMutation.isPending ||
    associateMutation.isPending

  // Aperçu du nom canonique qu'on aura après édition
  const plannedCanonicalName = useMemo(() => {
    if (!item) return null
    const finalSupplier = supplier || item.supplier || ''
    const finalDate = effectiveDate || item.best_date
    const finalAmount = effectiveAmount ?? item.best_amount ?? null
    if (!finalDate || finalAmount == null) return null
    const canonical = buildConventionFilename(
      finalSupplier,
      finalDate,
      finalAmount,
    )
    if (!canonical || canonical === item.filename) return null
    return canonical
  }, [supplier, effectiveDate, effectiveAmount, item])

  const handleValidate = async () => {
    if (!item) return
    let currentFilename = item.filename

    // 1. Update OCR data + hints si changements
    if (hasOcrChanges || hasHintChanges) {
      const data: Record<string, unknown> = {}
      if (
        effectiveAmount !== (item.best_amount ?? null) &&
        effectiveAmount !== null
      ) {
        data.best_amount = effectiveAmount
      }
      if (effectiveDate !== (item.best_date ?? null) && effectiveDate) {
        data.best_date = effectiveDate
      }
      if (supplier !== (item.supplier || '')) {
        data.supplier = supplier
      }
      // Hints cat/sous-cat — chaîne vide envoyée explicitement pour reset
      // (backend traite "" comme null et supprime le champ du .ocr.json)
      if (catFilter !== (item.category_hint || '')) {
        data.category_hint = catFilter
      }
      if (subCatFilter !== (item.sous_categorie_hint || '')) {
        data.sous_categorie_hint = subCatFilter
      }
      if (Object.keys(data).length > 0) {
        try {
          await updateOcrMutation.mutateAsync({
            filename: currentFilename,
            data,
          })
        } catch (err) {
          toast.error(`Erreur édition OCR : ${(err as Error).message}`)
          return
        }
      }
    }

    // 2. Rename canonique si on a un nom valide (association OU simple édition OCR)
    if (plannedCanonicalName) {
      try {
        const result = await renameMutation.mutateAsync({
          filename: currentFilename,
          newFilename: plannedCanonicalName,
        })
        currentFilename = result.new
      } catch (err) {
        toast.error(`Erreur renommage : ${(err as Error).message}`)
        return
      }
    }

    // 3. Associate si op sélectionnée
    if (selectedOpKey) {
      const [opFile, opIdxStr] = selectedOpKey.split('::')
      const opIdx = parseInt(opIdxStr, 10)
      try {
        await associateMutation.mutateAsync({
          justificatif_filename: currentFilename,
          operation_file: opFile,
          operation_index: opIdx,
        })
        toast.success(
          plannedCanonicalName
            ? `Renommé en ${currentFilename} et associé`
            : 'Justificatif associé',
        )
      } catch (err) {
        toast.error(`Erreur association : ${(err as Error).message}`)
        return
      }
    } else if (plannedCanonicalName && currentFilename !== item.filename) {
      toast.success(`Renommé en ${currentFilename}`)
    } else if (hasOcrChanges || hasHintChanges) {
      toast.success('Données OCR mises à jour')
    }

    // 4. Invalider ocr-history pour rafraîchir la table
    queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
    onClose()
  }

  const canValidate = hasOcrChanges || hasHintChanges || !!selectedOpKey

  if (!item && !open) return null

  const previewUrl = item
    ? `/api/justificatifs/${encodeURIComponent(item.filename)}/preview#toolbar=1`
    : ''
  const isPreviewActive = !!previewFilename

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sous-drawer preview PDF grand format (slide depuis la gauche) */}
      <PreviewSubDrawer
        filename={previewFilename}
        mainDrawerOpen={open}
        mainDrawerWidth={720}
        onClose={() => setPreviewFilename(null)}
      />

      {/* Drawer principal */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[720px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={18} className="text-primary shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text truncate">
                  Éditer les données OCR
                </h2>
                {item && (
                  <p className="text-[11px] font-mono text-text-muted truncate">
                    {item.filename}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text shrink-0"
              title="Fermer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {item && (
            <div className="flex gap-3">
              {/* Preview PDF iframe — cliquable pour ouvrir le sub-drawer grand format */}
              <button
                type="button"
                onClick={() =>
                  setPreviewFilename(isPreviewActive ? null : item.filename)
                }
                className={cn(
                  'shrink-0 w-[220px] h-[300px] bg-white rounded border overflow-hidden relative group cursor-pointer transition-colors',
                  isPreviewActive
                    ? 'border-primary ring-2 ring-primary/40'
                    : 'border-border hover:border-primary',
                )}
                title={isPreviewActive ? 'Fermer l\'aperçu' : 'Agrandir le PDF'}
              >
                <iframe
                  src={previewUrl}
                  title={item.filename}
                  className="w-full h-full pointer-events-none"
                />
                {/* Overlay hover */}
                <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Maximize2 size={20} className="text-white" />
                </span>
              </button>

              {/* Éditeur OCR compact */}
              <div className="flex-1 min-w-0 space-y-3">
                {/* Fournisseur */}
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
                    Fournisseur
                  </label>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Nom du fournisseur"
                    className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1.5 text-sm text-text"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
                    Date facture
                  </label>
                  {filteredDates.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5 mb-1">
                      {filteredDates.map((d, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedDate(d)
                            setUseManualDate(false)
                            setManualDate('')
                          }}
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                            !useManualDate && selectedDate === d
                              ? 'bg-primary text-white border-primary'
                              : 'border-border text-text-muted hover:border-primary',
                          )}
                        >
                          {d.split('-').reverse().join('/')}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => {
                      setManualDate(e.target.value)
                      setUseManualDate(true)
                      setSelectedDate(null)
                    }}
                    className="mt-0.5 bg-background border border-border rounded px-2 py-1.5 text-sm text-text"
                  />
                </div>

                {/* Montant */}
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
                    Montant TTC
                  </label>
                  {amountCandidates.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5 mb-1">
                      {amountCandidates.map((amt, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedAmount(amt)
                            setUseManualAmount(false)
                            setManualAmount('')
                          }}
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                            !useManualAmount && selectedAmount === amt
                              ? 'bg-primary text-white border-primary'
                              : 'border-border text-text-muted hover:border-primary',
                          )}
                        >
                          {formatCurrency(amt)}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Autre montant"
                    value={manualAmount}
                    onChange={(e) => {
                      setManualAmount(e.target.value)
                      setUseManualAmount(true)
                      setSelectedAmount(null)
                    }}
                    className="mt-0.5 bg-background border border-border rounded px-2 py-1.5 text-sm text-text w-36"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Catégorie / sous-catégorie (filtres op selector) */}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={catFilter}
              onChange={(e) => {
                setCatFilter(e.target.value)
                setSubCatFilter('')
              }}
              className="bg-background border border-border rounded px-2 py-1.5 text-sm text-text"
            >
              <option value="">Catégorie (filtre ops)</option>
              {categoryNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={subCatFilter}
              onChange={(e) => setSubCatFilter(e.target.value)}
              disabled={
                !catFilter || (subcategoriesMap.get(catFilter) ?? []).length === 0
              }
              className="bg-background border border-border rounded px-2 py-1.5 text-sm text-text disabled:opacity-40"
            >
              <option value="">Sous-catégorie</option>
              {(subcategoriesMap.get(catFilter) ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Op selector */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
              Associer à une opération ({opCandidates.length} candidate
              {opCandidates.length > 1 ? 's' : ''})
            </label>
            <select
              value={selectedOpKey}
              onChange={(e) => setSelectedOpKey(e.target.value)}
              className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1.5 text-sm text-text"
            >
              <option value="">Ne pas associer maintenant</option>
              {opCandidates.map((op) => {
                const key = `${op._filename}::${op._originalIndex}`
                const amount = op['Débit'] || op['Crédit'] || 0
                return (
                  <option key={key} value={key}>
                    {op['Date']} ·{' '}
                    {(op['Libellé'] || '').slice(0, 40)} ·{' '}
                    {formatCurrency(amount)}
                    {op['Catégorie'] ? ` · ${op['Catégorie']}` : ''}
                  </option>
                )
              })}
            </select>
          </div>

          {/* Preview canonique */}
          {plannedCanonicalName && (
            <div className="flex items-center gap-2 text-xs text-text-muted bg-surface/60 rounded-md px-3 py-2 border border-border">
              <span>Nom canonique proposé :</span>
              <ArrowRight size={12} className="shrink-0" />
              <code className="font-mono text-emerald-400 truncate">
                {plannedCanonicalName}
              </code>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
          >
            Fermer
          </button>
          <button
            onClick={handleValidate}
            disabled={!canValidate || isSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            {selectedOpKey
              ? plannedCanonicalName
                ? 'Renommer & associer'
                : 'Associer'
              : 'Enregistrer'}
          </button>
        </div>
      </div>
    </>
  )
}
