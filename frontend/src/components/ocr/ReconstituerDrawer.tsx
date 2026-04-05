import { useState, useMemo, useEffect } from 'react'
import { X, FileText, Loader2, CheckCircle, Calculator } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useTemplate, useGenerateReconstitue, useTemplateSuggestion } from '@/hooks/useTemplates'
import type { JustificatifTemplate, TemplateField } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  operationFile: string
  operationIndex: number
  libelle: string
  suggestedTemplateId?: string
  onGenerated?: () => void
}

export default function ReconstituerDrawer({
  open, onClose, operationFile, operationIndex, libelle,
  suggestedTemplateId, onGenerated,
}: Props) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(suggestedTemplateId || '')
  const [fieldValues, setFieldValues] = useState<Record<string, string | number>>({})

  const { data: suggestions } = useTemplateSuggestion(operationFile, operationIndex)
  const { data: template } = useTemplate(selectedTemplateId || null)
  const generate = useGenerateReconstitue()

  // Auto-sélectionner le template suggéré
  useEffect(() => {
    if (suggestedTemplateId) {
      setSelectedTemplateId(suggestedTemplateId)
    } else if (suggestions?.length) {
      setSelectedTemplateId(suggestions[0].template_id)
    }
  }, [suggestedTemplateId, suggestions])

  // Reset field values quand le template change
  useEffect(() => {
    if (template) {
      const defaults: Record<string, string | number> = {}
      for (const f of template.fields) {
        if (f.source === 'fixed' && f.default !== undefined) {
          defaults[f.key] = f.default
        }
      }
      setFieldValues(defaults)
    }
  }, [template?.id])

  // Calcul TVA temps réel
  const computedValues = useMemo(() => {
    if (!template) return {}
    const result: Record<string, number | null> = {}
    const allValues: Record<string, number> = {}

    // Collecter toutes les valeurs numériques
    for (const f of template.fields) {
      if (f.source === 'operation' && f.key === 'montant_ttc') {
        allValues[f.key] = 0 // sera rempli côté backend
      } else if (f.source === 'fixed' || f.source === 'manual') {
        const v = fieldValues[f.key]
        allValues[f.key] = typeof v === 'number' ? v : parseFloat(String(v)) || 0
      }
    }

    // Évaluer les formules
    for (const f of template.fields) {
      if (f.source === 'computed' && f.formula) {
        try {
          let expr = f.formula
          for (const [k, v] of Object.entries(allValues)) {
            expr = expr.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), String(v))
          }
          if (/^[\d\s.+\-*/()]+$/.test(expr)) {
            result[f.key] = Math.round(eval(expr) * 100) / 100
          }
        } catch { /* ignore */ }
      }
    }
    return result
  }, [template, fieldValues])

  const handleGenerate = (autoAssociate: boolean) => {
    if (!selectedTemplateId) return
    generate.mutate(
      {
        template_id: selectedTemplateId,
        operation_file: operationFile,
        operation_index: operationIndex,
        field_values: fieldValues,
        auto_associate: autoAssociate,
      },
      {
        onSuccess: () => {
          onGenerated?.()
          onClose()
        },
      },
    )
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 transition-opacity" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-violet-400" />
              <h2 className="text-sm font-semibold text-text">
                Reconstituer {template ? `— ${template.vendor}` : ''}
              </h2>
            </div>
            <button onClick={onClose} className="p-1 text-text-muted hover:text-text">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Opération source */}
          <div className="bg-surface rounded-lg border border-border p-3">
            <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Opération source</p>
            <p className="text-sm text-text font-medium truncate">{libelle}</p>
            <p className="text-[10px] text-text-muted mt-1">
              {operationFile} — index {operationIndex}
            </p>
          </div>

          {/* Sélection template */}
          {suggestions && suggestions.length > 0 && (
            <div>
              <label className="text-xs text-text-muted mb-1.5 block">Template</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="">Sélectionner...</option>
                {suggestions.map((s) => (
                  <option key={s.template_id} value={s.template_id}>
                    {s.vendor} — match {Math.round(s.match_score * 100)}% ({s.fields_count} champs)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Formulaire champs */}
          {template && (
            <div className="space-y-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">Champs du template</p>

              <div className="grid grid-cols-2 gap-3">
                {template.fields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={
                      field.source === 'computed'
                        ? computedValues[field.key] ?? ''
                        : fieldValues[field.key] ?? ''
                    }
                    onChange={(val) =>
                      setFieldValues((prev) => ({ ...prev, [field.key]: val }))
                    }
                    readOnly={field.source === 'operation' || field.source === 'computed'}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={() => handleGenerate(false)}
            disabled={!selectedTemplateId || generate.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition-colors disabled:opacity-50"
          >
            {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Générer PDF
          </button>
          <button
            onClick={() => handleGenerate(true)}
            disabled={!selectedTemplateId || generate.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Générer + associer
          </button>
        </div>
      </div>
    </>
  )
}


function FieldInput({
  field, value, onChange, readOnly,
}: {
  field: TemplateField
  value: string | number
  onChange: (val: string | number) => void
  readOnly: boolean
}) {
  const isAuto = field.source === 'operation' || field.source === 'computed'

  return (
    <div className={cn(field.key === 'montant_ttc' ? 'col-span-2' : '')}>
      <label className="text-[10px] text-text-muted mb-0.5 flex items-center gap-1">
        {field.label}
        {isAuto && <Calculator size={9} className="text-violet-400" />}
        {field.required && <span className="text-red-400">*</span>}
      </label>

      {field.type === 'select' && field.options ? (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className={cn(
            'w-full bg-surface border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary',
            isAuto ? 'border-dashed border-border/60 text-text-muted bg-surface/50' : 'border-border',
          )}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'date' ? 'date' : field.type === 'currency' || field.type === 'number' || field.type === 'percent' ? 'number' : 'text'}
          step={field.type === 'currency' ? '0.01' : field.type === 'percent' ? '1' : undefined}
          value={value}
          onChange={(e) => {
            const v = e.target.value
            onChange(field.type === 'currency' || field.type === 'number' || field.type === 'percent' ? parseFloat(v) || 0 : v)
          }}
          readOnly={readOnly}
          placeholder={isAuto ? '(auto)' : ''}
          className={cn(
            'w-full bg-surface border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary',
            isAuto ? 'border-dashed border-border/60 text-text-muted bg-surface/50' : 'border-border',
          )}
        />
      )}
    </div>
  )
}
