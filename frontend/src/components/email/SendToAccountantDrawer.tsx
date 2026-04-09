import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  X, Send, Search, Check, Loader2, Archive, FileText,
  FileSpreadsheet, Paperclip, FolderOpen, Mail, CheckCircle2, XCircle, ChevronDown, ChevronRight,
} from 'lucide-react'
import { cn, MOIS_FR } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { useAvailableDocuments, useEmailPreview, useSendEmail, useEmailHistory } from '@/hooks/useEmail'
import { useSettings } from '@/hooks/useApi'
import EmailChipsInput from '@/components/common/EmailChipsInput'
import type { DocumentRef, DocumentInfo, DocumentType, EmailHistoryEntry } from '@/types'

const TYPE_CONFIG: { key: DocumentType; label: string; icon: typeof Archive }[] = [
  { key: 'export', label: 'Exports', icon: Archive },
  { key: 'rapport', label: 'Rapports', icon: FileText },
  { key: 'releve', label: 'Relevés', icon: FileSpreadsheet },
  { key: 'justificatif', label: 'Justificatifs', icon: Paperclip },
  { key: 'ged', label: 'Documents', icon: FolderOpen },
]

const MAX_SIZE_MB = 25

export default function SendToAccountantDrawer() {
  const { isOpen, preselected, defaultFilter, close } = useSendDrawerStore()
  const { data: settings } = useSettings()
  const { data: allDocuments, isLoading: docsLoading } = useAvailableDocuments()
  const previewMutation = useEmailPreview()
  const sendMutation = useSendEmail()

  // Tabs
  const [activeTab, setActiveTab] = useState<'nouveau' | 'historique'>('nouveau')

  // Filters
  const [activeTypes, setActiveTypes] = useState<Set<DocumentType>>(new Set(TYPE_CONFIG.map(t => t.key)))
  const [search, setSearch] = useState('')
  const [filterYear, setFilterYear] = useState<number | undefined>(undefined)
  const [filterMonth, setFilterMonth] = useState<number | undefined>(undefined)

  // Selection
  const [selected, setSelected] = useState<Map<string, DocumentRef>>(new Map())

  // Email fields
  const [destinataires, setDestinataires] = useState<string[]>([])
  const [objet, setObjet] = useState('')
  const [corps, setCorps] = useState('')

  // Init on open
  useEffect(() => {
    if (!isOpen) return
    // Reset
    setActiveTab('nouveau')
    setSearch('')
    setFilterYear(undefined)
    setFilterMonth(undefined)
    if (defaultFilter) {
      // Show both the requested type + rapports for related context
      const types = new Set([defaultFilter as DocumentType])
      if (defaultFilter === 'export') types.add('rapport')
      setActiveTypes(types)
    } else {
      setActiveTypes(new Set(TYPE_CONFIG.map(t => t.key)))
    }
    // Preselect — explicit or smart
    const sel = new Map<string, DocumentRef>()
    if (preselected.length > 0) {
      for (const doc of preselected) {
        sel.set(doc.filename, doc)
      }
    } else if (defaultFilter === 'export' && allDocuments) {
      // Smart pre-selection: select the most recent export + matching rapports
      const exports = allDocuments.filter(d => d.type === 'export')
      const rapports = allDocuments.filter(d => d.type === 'rapport')
      // Select the most recent export (first in list, they come sorted by date desc)
      if (exports.length > 0) {
        sel.set(exports[0].filename, { type: 'export', filename: exports[0].filename })
      }
      // Select all rapports (usually few — Export Comptable + Compte d'attente)
      for (const r of rapports) {
        sel.set(r.filename, { type: 'rapport', filename: r.filename })
      }
    }
    setSelected(sel)
    // Recipients from settings
    setDestinataires(settings?.email_comptable_destinataires ?? [])
    setObjet('')
    setCorps('')
  }, [isOpen, preselected, defaultFilter, settings])

  // Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, close])

  // Auto-preview with debounce
  const previewTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!isOpen || selected.size === 0) return
    clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      const docs = Array.from(selected.values())
      previewMutation.mutate({ documents: docs }, {
        onSuccess: (data) => {
          setObjet(prev => prev || data.objet)
          setCorps(prev => prev || data.corps)
          if (destinataires.length === 0 && data.destinataires.length > 0) {
            setDestinataires(data.destinataires)
          }
        },
      })
    }, 500)
    return () => clearTimeout(previewTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selected])

  // Available years from documents
  const availableYears = useMemo(() => {
    if (!allDocuments) return []
    const years = new Set<number>()
    for (const d of allDocuments) {
      const m = d.filename.match(/(\d{4})/)
      if (m) years.add(parseInt(m[1]))
    }
    return Array.from(years).filter(y => y >= 2020 && y <= 2030).sort((a, b) => b - a)
  }, [allDocuments])

  // Filter docs
  const filteredDocs = useMemo(() => {
    if (!allDocuments) return []
    const q = search.toLowerCase()
    return allDocuments.filter(d => {
      if (!activeTypes.has(d.type as DocumentType)) return false
      if (q && !d.display_name.toLowerCase().includes(q) && !d.filename.toLowerCase().includes(q)) return false
      if (filterYear) {
        const ys = String(filterYear)
        if (!d.filename.includes(ys) && !d.display_name.includes(ys) && !(d.date && d.date.startsWith(ys))) return false
      }
      if (filterMonth) {
        const monthStr = String(filterMonth).padStart(2, '0')
        const monthName = MOIS_FR[filterMonth - 1]?.toLowerCase()
        const matchesFilename = d.filename.includes(monthStr) || (monthName && d.filename.toLowerCase().includes(monthName))
        const matchesDisplay = monthName && d.display_name.toLowerCase().includes(monthName)
        const matchesDate = d.date && d.date.substring(5, 7) === monthStr
        if (!matchesFilename && !matchesDisplay && !matchesDate) return false
      }
      return true
    })
  }, [allDocuments, activeTypes, search, filterYear, filterMonth])

  // Group by type — ordered: exports, rapports, relevés, justificatifs, ged
  const grouped = useMemo(() => {
    const buckets: Record<string, DocumentInfo[]> = {}
    for (const d of filteredDocs) {
      ;(buckets[d.type] ??= []).push(d)
    }
    const ordered = new Map<string, DocumentInfo[]>()
    for (const { key } of TYPE_CONFIG) {
      if (buckets[key]?.length) ordered.set(key, buckets[key])
    }
    return ordered
  }, [filteredDocs])

  // Expanders — smart collapse: groups with >=10 docs start collapsed
  const COLLAPSE_THRESHOLD = 10
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const toCollapse = new Set<string>()
    for (const [type, docs] of grouped.entries()) {
      if (docs.length >= COLLAPSE_THRESHOLD) toCollapse.add(type)
    }
    setCollapsed(toCollapse)
  // Only recompute on grouped identity change (not every render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped.size])

  const toggleCollapse = useCallback((type: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const toggleDoc = useCallback((doc: DocumentInfo) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(doc.filename)) {
        next.delete(doc.filename)
      } else {
        next.set(doc.filename, { type: doc.type as DocumentType, filename: doc.filename })
      }
      return next
    })
  }, [])

  const toggleType = (type: DocumentType) => {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) { if (next.size > 1) next.delete(type) }
      else next.add(type)
      return next
    })
  }

  const selectedDocs = Array.from(selected.values())
  const totalSize = useMemo(() => {
    if (!allDocuments) return 0
    return selectedDocs.reduce((sum, ref) => {
      const doc = allDocuments.find(d => d.filename === ref.filename)
      return sum + (doc?.size_bytes ?? 0)
    }, 0)
  }, [selectedDocs, allDocuments])
  const totalSizeMb = totalSize / (1024 * 1024)
  const overLimit = totalSizeMb > MAX_SIZE_MB

  const handleSend = useCallback(() => {
    if (destinataires.length === 0 || selected.size === 0) return
    sendMutation.mutate(
      { documents: selectedDocs, destinataires, objet, corps },
      {
        onSuccess: (result) => {
          if (result.success) {
            toast.success(result.message)
            close()
          } else {
            toast.error(result.message)
          }
        },
        onError: (err) => toast.error(err.message),
      }
    )
  }, [destinataires, selectedDocs, objet, corps, sendMutation, close, selected.size])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop + Drawer wrapper */}
      <div className="fixed inset-0 z-[100] flex justify-end" onClick={close}>
        <div
          className="h-full w-full max-w-[1100px] bg-surface border-l border-border flex flex-col shadow-2xl"
          onClick={e => e.stopPropagation()}
        >

          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <Send size={20} className="text-primary" />
              <h2 className="text-base font-semibold text-text">Envoi comptable</h2>
            </div>
            <button onClick={close} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover">
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 px-5 border-b border-border shrink-0">
            <button
              onClick={() => setActiveTab('nouveau')}
              className={cn(
                'py-2.5 text-sm transition-colors border-b-2',
                activeTab === 'nouveau'
                  ? 'text-text font-medium border-primary'
                  : 'text-text-muted border-transparent hover:text-text'
              )}
            >
              Nouveau
            </button>
            <button
              onClick={() => setActiveTab('historique')}
              className={cn(
                'py-2.5 text-sm transition-colors border-b-2',
                activeTab === 'historique'
                  ? 'text-text font-medium border-primary'
                  : 'text-text-muted border-transparent hover:text-text'
              )}
            >
              Historique
            </button>
          </div>

          {activeTab === 'historique' ? (
            <EmailHistoryPanel />
          ) : (
          <div className="flex flex-1 min-h-0">
          {/* ── Left column: Document selection ── */}
          <div className="flex-[55] flex flex-col border-r border-border min-w-0">

          {/* Type filters */}
          <div className="px-5 py-3 border-b border-border space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {TYPE_CONFIG.map(t => {
                const active = activeTypes.has(t.key)
                return (
                  <button
                    key={t.key}
                    onClick={() => toggleType(t.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                      active
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'border border-border text-text-muted hover:text-text'
                    )}
                  >
                    <t.icon size={12} />
                    {t.label}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <select
                value={filterYear ?? ''}
                onChange={e => { setFilterYear(e.target.value ? parseInt(e.target.value) : undefined); if (!e.target.value) setFilterMonth(undefined) }}
                className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
              >
                <option value="">Toutes années</option>
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                value={filterMonth ?? ''}
                onChange={e => setFilterMonth(e.target.value ? parseInt(e.target.value) : undefined)}
                disabled={!filterYear}
                className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary disabled:opacity-40"
              >
                <option value="">Tous mois</option>
                {MOIS_FR.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
            {docsLoading ? (
              <div className="flex items-center justify-center py-12 text-text-muted">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : filteredDocs.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-12">Aucun document trouvé</p>
            ) : (
              Array.from(grouped.entries()).map(([type, docs]) => {
                const config = TYPE_CONFIG.find(t => t.key === type)
                if (!config) return null
                const Icon = config.icon
                const allChecked = docs.every(d => selected.has(d.filename))
                const isCollapsed = collapsed.has(type)
                const selectedInGroup = docs.filter(d => selected.has(d.filename)).length

                return (
                  <div key={type}>
                    <div className="flex items-center gap-1 mb-1.5">
                      {/* Expand/collapse toggle */}
                      <button
                        onClick={() => toggleCollapse(type)}
                        className="p-0.5 text-text-muted hover:text-text transition-colors"
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {/* Select-all checkbox */}
                      <button
                        onClick={() => {
                          if (allChecked) {
                            setSelected(prev => {
                              const next = new Map(prev)
                              docs.forEach(d => next.delete(d.filename))
                              return next
                            })
                          } else {
                            setSelected(prev => {
                              const next = new Map(prev)
                              docs.forEach(d => next.set(d.filename, { type: d.type as DocumentType, filename: d.filename }))
                              return next
                            })
                          }
                        }}
                        className="flex items-center gap-2 text-[10px] font-semibold text-text-muted uppercase hover:text-text flex-1"
                      >
                        <div className={cn(
                          'w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-all',
                          allChecked ? 'bg-primary border-transparent' : 'border-text-muted/30'
                        )}>
                          {allChecked && <Check size={10} className="text-white" />}
                        </div>
                        <Icon size={12} />
                        {config.label} ({docs.length})
                        {isCollapsed && selectedInGroup > 0 && (
                          <span className="text-[9px] text-primary font-normal normal-case ml-1">
                            {selectedInGroup} sélectionné{selectedInGroup > 1 ? 's' : ''}
                          </span>
                        )}
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="space-y-0.5">
                        {docs.map(d => (
                          <button
                            key={d.filename}
                            onClick={() => toggleDoc(d)}
                            className={cn(
                              'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors',
                              selected.has(d.filename) ? 'bg-primary/8' : 'hover:bg-surface-hover'
                            )}
                          >
                            <div className={cn(
                              'w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-all',
                              selected.has(d.filename) ? 'bg-primary border-transparent' : 'border-text-muted/30'
                            )}>
                              {selected.has(d.filename) && <Check size={10} className="text-white" />}
                            </div>
                            <span className="text-xs text-text truncate flex-1">{d.display_name}</span>
                            <span className="text-[10px] text-text-muted shrink-0">{formatSize(d.size_bytes)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer left — size gauge */}
          <div className="px-5 py-3 border-t border-border space-y-1.5">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>{selected.size} document{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}</span>
              <span className={cn(overLimit && 'text-danger font-medium')}>
                {totalSizeMb.toFixed(1)} / {MAX_SIZE_MB} Mo
              </span>
            </div>
            <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  overLimit ? 'bg-danger' : totalSizeMb > MAX_SIZE_MB * 0.8 ? 'bg-amber-500' : 'bg-primary'
                )}
                style={{ width: `${Math.min((totalSizeMb / MAX_SIZE_MB) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Right column: Email composition ── */}
        <div className="flex-[45] flex flex-col min-w-0">
          <div className="p-5 border-b border-border">
            <p className="text-xs font-semibold text-text-muted uppercase">Composer le message</p>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* To */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">À</label>
              <EmailChipsInput
                emails={destinataires}
                onChange={setDestinataires}
                placeholder="comptable@cabinet.fr"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">Objet</label>
              <input
                type="text"
                value={objet}
                onChange={e => setObjet(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>

            {/* Body */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">Message</label>
              <textarea
                value={corps}
                onChange={e => setCorps(e.target.value)}
                rows={6}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Attachments preview */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1.5">
                Pièces jointes ({selected.size})
              </label>
              <div className="bg-background border border-border rounded-lg max-h-[140px] overflow-y-auto divide-y divide-border/50">
                {selectedDocs.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-3">Aucun document sélectionné</p>
                ) : selectedDocs.map(ref => {
                  const doc = allDocuments?.find(d => d.filename === ref.filename)
                  return (
                    <div key={ref.filename} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <Paperclip size={11} className="text-primary shrink-0" />
                      <span className="truncate flex-1 text-text">{ref.filename}</span>
                      <span className="text-text-muted shrink-0">{doc ? formatSize(doc.size_bytes) : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Size gauge */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                <span>Total : {totalSizeMb.toFixed(1)} Mo</span>
                <span>{MAX_SIZE_MB} Mo</span>
              </div>
              <div className="w-full h-2 bg-background rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    overLimit ? 'bg-danger' : 'bg-blue-500'
                  )}
                  style={{ width: `${Math.min((totalSizeMb / MAX_SIZE_MB) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Footer right */}
          <div className="p-5 border-t border-border flex items-center justify-end gap-2">
            <button
              onClick={close}
              className="px-4 py-2 text-sm bg-surface-hover rounded-lg hover:bg-border transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSend}
              disabled={sendMutation.isPending || selected.size === 0 || destinataires.length === 0 || overLimit}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
            >
              {sendMutation.isPending ? (
                <><Loader2 size={14} className="animate-spin" /> Envoi en cours...</>
              ) : (
                <><Send size={14} /> Envoyer ({selected.size} docs)</>
              )}
            </button>
          </div>
        </div>
          </div>
          )}
        </div>
      </div>
    </>
  )
}


// ──── Email History Panel ────

function EmailHistoryPanel() {
  const { data: history, isLoading } = useEmailHistory()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  const entries = history ?? []

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
        <Mail size={40} className="opacity-30 mb-3" />
        <p className="text-sm">Aucun envoi pour le moment</p>
      </div>
    )
  }

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      }) + ' à ' + d.toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  const typeBadge = (type: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      export: { label: 'Export', cls: 'bg-primary/10 text-primary' },
      rapport: { label: 'Rapport', cls: 'bg-info/10 text-info' },
      releve: { label: 'Relevé', cls: 'bg-amber-500/10 text-amber-400' },
      justificatif: { label: 'Justif.', cls: 'bg-success/10 text-success' },
      ged: { label: 'Doc', cls: 'bg-text-muted/10 text-text-muted' },
    }
    return map[type] ?? { label: type, cls: 'bg-surface text-text-muted' }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-2">
      {entries.map(entry => {
        const isExpanded = expanded === entry.id
        const destDisplay = entry.destinataires.length <= 2
          ? entry.destinataires.join(', ')
          : `${entry.destinataires[0]}, +${entry.destinataires.length - 1}`

        return (
          <button
            key={entry.id}
            onClick={() => setExpanded(isExpanded ? null : entry.id)}
            className="w-full text-left bg-surface rounded-lg p-4 border border-border hover:bg-surface-hover transition-colors"
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-1.5">
              <div className={cn(
                'w-2 h-2 rounded-full shrink-0',
                entry.success ? 'bg-emerald-400' : 'bg-danger'
              )} />
              <span className="text-xs text-text-muted">{formatDate(entry.sent_at)}</span>
              <span className="text-xs text-text-muted ml-auto truncate max-w-[200px]">{destDisplay}</span>
            </div>

            {/* Subject */}
            <p className="text-sm font-medium text-text truncate">{entry.objet}</p>

            {/* Details */}
            <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
              <span>{entry.nb_documents} document{entry.nb_documents > 1 ? 's' : ''}</span>
              <span>{entry.taille_totale_mo} Mo</span>
              {entry.success ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 size={11} /> Envoyé
                </span>
              ) : (
                <span className="flex items-center gap-1 text-danger">
                  <XCircle size={11} /> Échec
                </span>
              )}
              <ChevronDown size={12} className={cn('ml-auto transition-transform', isExpanded && 'rotate-180')} />
            </div>

            {/* Error message */}
            {!entry.success && entry.error_message && (
              <p className="text-xs text-danger mt-1.5">{entry.error_message}</p>
            )}

            {/* Expanded: document list */}
            {isExpanded && (
              <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
                {entry.documents.map((doc, i) => {
                  const badge = typeBadge(doc.type)
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', badge.cls)}>{badge.label}</span>
                      <span className="truncate text-text">{doc.filename}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
