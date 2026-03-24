import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: string
  icon?: ReactNode
  trend?: 'up' | 'down' | 'neutral'
  className?: string
  onClick?: () => void
}

export default function MetricCard({ title, value, icon, trend, className, onClick }: MetricCardProps) {
  return (
    <div
      className={cn(
        'bg-surface rounded-xl border border-border p-5',
        onClick && 'cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all',
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{title}</p>
        {icon && <div className="text-text-muted">{icon}</div>}
      </div>
      <p
        className={cn(
          'text-2xl font-bold mt-2',
          trend === 'up' && 'text-success',
          trend === 'down' && 'text-danger',
          !trend && 'text-text'
        )}
      >
        {value}
      </p>
    </div>
  )
}
