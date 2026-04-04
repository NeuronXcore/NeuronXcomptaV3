import { useNavigate } from 'react-router-dom'
import { Upload, ScanLine, GitCompareArrows, Loader2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'

interface YearSelectorProps {
  year: number
  years: number[]
  onChange: (y: number) => void
}

export default function YearSelector({ year, years, onChange }: YearSelectorProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const rapproMutation = useMutation({
    mutationFn: () => api.post('/rapprochement/run-auto'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['year-overview'] })
      toast.success('Rapprochement automatique terminé')
    },
    onError: () => toast.error('Erreur rapprochement'),
  })

  return (
    <div className="flex items-center gap-2">
      <select
        value={year}
        onChange={e => onChange(parseInt(e.target.value))}
        className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
      >
        {years.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      <button
        onClick={() => navigate('/import')}
        className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-xs hover:bg-surface-hover transition-colors"
      >
        <Upload size={14} />
        Importer
      </button>
      <button
        onClick={() => navigate('/ocr')}
        className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-xs hover:bg-surface-hover transition-colors"
      >
        <ScanLine size={14} />
        OCR
      </button>
      <button
        onClick={() => rapproMutation.mutate()}
        disabled={rapproMutation.isPending}
        className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-xs hover:bg-surface-hover transition-colors disabled:opacity-50"
      >
        {rapproMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <GitCompareArrows size={14} />}
        Rapprocher
      </button>
    </div>
  )
}
