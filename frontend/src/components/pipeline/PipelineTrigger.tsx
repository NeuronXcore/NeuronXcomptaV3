import { Rocket } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PipelineTriggerProps {
  globalProgress: number
  onClick: () => void
}

function badgeColor(percent: number): string {
  if (percent >= 80) return 'bg-success'
  if (percent > 40) return 'bg-warning'
  return 'bg-danger'
}

export default function PipelineTrigger({ globalProgress, onClick }: PipelineTriggerProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-primary text-white rounded-full shadow-lg hover:bg-primary-dark transition-all hover:scale-105 active:scale-95"
      title="Pipeline comptable"
    >
      <Rocket className="w-5 h-5" />
      <span
        className={cn(
          'text-xs font-bold px-2 py-0.5 rounded-full text-white',
          badgeColor(globalProgress)
        )}
      >
        {globalProgress}%
      </span>
    </button>
  )
}
