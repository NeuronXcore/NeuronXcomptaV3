import { useState, useEffect, useMemo } from 'react'
import { X, Search, Check, FileText, File, Loader2, FolderOpen, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAvailableReports } from '@/hooks/useExports'
import type { AvailableReport } from '@/hooks/useExports'

interface ReportSelectionDrawerProps {
  isOpen: boolean
  onClose: () => void
  year: number
  month: number
  monthLabel: string
  format: 'pdf' | 'csv'
  onConfirm: (selectedFilenames: string[]) => void
}

export default function ReportSelectionDrawer({
  isOpen, onClose, year, month, monthLabel, format, onConfirm,
}: ReportSelectionDrawerProps) {
  const { data, isLoading } = useAvailableReports(year, month, isOpen)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const reports = data?.reports ?? []

  // Init selection with auto-detected reports when data loads
  useEffect(() => {
    if (reports.length > 0) {
      setSelected(new Set(reports.filter(r => r.auto_detected).map(r => r.filename)))
    }
  }, [reports])

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

  // Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const toggle = (filename: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }

  const autoDetected = useMemo(() => reports.filter(r => r.auto_detected), [reports])
  const others = useMemo(() => {
    const q = search.toLowerCase()
    return reports
      .filter(r => !r.auto_detected)
      .filter(r => !q || r.title.toLowerCase().includes(q) || r.filename.toLowerCase().includes(q))
  }, [reports, search])

  const formatBadge = (fmt: string) => {
    const colors: Record<string, string> = {
      pdf: 'bg-danger/20 text-danger',
      csv: 'bg-success/20 text-success',
      excel: 'bg-info/20 text-info',
    }
    return colors[fmt] ?? 'bg-surface text-text-muted'
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[500px] max-w-[90vw] bg-surface border-l border-border z-50 flex flex-col transition-transform duration-200',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text flex items-center gap-2">
              <FolderOpen size={18} className="text-primary" />
              Rapports à inclure
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {monthLabel} {year} — Export {format.toUpperCase()}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un rapport..."
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-12">Aucun rapport disponible</p>
          ) : (
            <>
              {/* Auto-detected */}
              {autoDetected.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase mb-2">
                    Auto-détectés ({autoDetected.length})
                  </p>
                  <div className="space-y-1">
                    {autoDetected.map(r => (
                      <ReportRow
                        key={r.filename}
                        report={r}
                        isSelected={selected.has(r.filename)}
                        onToggle={() => toggle(r.filename)}
                        formatBadge={formatBadge}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Others */}
              {others.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase mb-2">
                    Autres rapports ({others.length})
                  </p>
                  <div className="space-y-1">
                    {others.map(r => (
                      <ReportRow
                        key={r.filename}
                        report={r}
                        isSelected={selected.has(r.filename)}
                        onToggle={() => toggle(r.filename)}
                        formatBadge={formatBadge}
                      />
                    ))}
                  </div>
                </div>
              )}

              {others.length === 0 && autoDetected.length === 0 && search && (
                <p className="text-sm text-text-muted text-center py-8">Aucun résultat pour "{search}"</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {selected.size} rapport{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-surface-hover rounded-lg hover:bg-border transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={() => onConfirm(Array.from(selected))}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              Générer {format.toUpperCase()} avec {selected.size} rapport{selected.size > 1 ? 's' : ''}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function ReportRow({
  report: r,
  isSelected,
  onToggle,
  formatBadge,
}: {
  report: AvailableReport
  isSelected: boolean
  onToggle: () => void
  formatBadge: (fmt: string) => string
}) {
  const Icon = r.format === 'csv' ? FileText : File
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
        isSelected ? 'bg-primary/8' : 'hover:bg-surface-hover'
      )}
    >
      <div
        className={cn(
          'w-[20px] h-[20px] rounded flex items-center justify-center border-2 shrink-0 transition-all',
          isSelected
            ? 'bg-primary border-transparent shadow-sm'
            : 'bg-surface border-text-muted/30'
        )}
      >
        {isSelected && <Check size={12} className="text-white" />}
      </div>
      <Icon size={14} className={cn('shrink-0', r.format === 'pdf' ? 'text-danger' : 'text-success')} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text truncate">{r.title}</p>
        <p className="text-[10px] text-text-muted truncate">{r.filename}</p>
      </div>
      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0', formatBadge(r.format))}>
        {r.format}
      </span>
    </button>
  )
}
