import { useEffect, useMemo, useState } from 'react'
import { ListChecks, AlertTriangle, Send, CheckCircle2, RotateCcw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import MetricCard from '@/components/shared/MetricCard'
import CheckSection from './CheckSection'
import MonthYearToggle from './MonthYearToggle'
import {
  useCheckInstance,
  useValidateCheck,
  useUnvalidateCheck,
  useCheckReminderState,
} from '@/hooks/useCheckEnvoi'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { MOIS_FR } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { CheckPeriod } from '@/types'

export default function CheckEnvoiPage() {
  const { selectedYear } = useFiscalYearStore()
  const now = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState<CheckPeriod>('month')
  const [month, setMonth] = useState<number>(now.getMonth() + 1)

  const { data: instance, isLoading } = useCheckInstance(
    selectedYear,
    period,
    period === 'month' ? month : undefined,
  )
  const reminderQuery = useCheckReminderState()
  const validate = useValidateCheck()
  const unvalidate = useUnvalidateCheck()
  const openDrawer = useSendDrawerStore((s) => s.open)

  // Sous-titre coloré J+N (depuis reminder state)
  const subtitle = useMemo(() => {
    const reminder = reminderQuery.data
    if (!reminder?.should_show || !reminder.message) return null
    return reminder.message
  }, [reminderQuery.data])

  // Reset month si on bascule sur Année puis Mois (garder le mois courant)
  useEffect(() => {
    if (period === 'month' && (month < 1 || month > 12)) {
      setMonth(now.getMonth() + 1)
    }
  }, [period, month, now])

  const periodLabel = useMemo(() => {
    if (period === 'year') return `Année ${selectedYear}`
    return `${MOIS_FR[month - 1].charAt(0).toUpperCase() + MOIS_FR[month - 1].slice(1)} ${selectedYear}`
  }, [period, month, selectedYear])

  const handleValidate = () => {
    validate.mutate({
      year: selectedYear,
      period,
      month: period === 'month' ? month : undefined,
    })
  }

  const handleUnvalidate = () => {
    unvalidate.mutate({
      year: selectedYear,
      period,
      month: period === 'month' ? month : undefined,
    })
  }

  const handlePrepareSend = () => {
    if (period !== 'month') return
    const monthName = MOIS_FR[month - 1].charAt(0).toUpperCase() + MOIS_FR[month - 1].slice(1)
    const subject = `Documents comptables — ${monthName} ${selectedYear}`
    openDrawer({
      defaultSubject: subject,
    })
  }

  if (isLoading || !instance) {
    return (
      <div className="p-6">
        <LoadingSpinner text="Chargement du check d'envoi…" />
      </div>
    )
  }

  const isValidated = !!instance.validated_at
  const counts = instance.counts || { ok: 0, warning: 0, blocking: 0, pending: 0 }
  const showSoftBanner = !instance.ready_for_send && !isValidated

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title={`Check d'envoi — ${periodLabel}`}
        description={
          subtitle
            ? subtitle
            : isValidated
              ? `Validé le ${new Date(instance.validated_at!).toLocaleDateString('fr-FR')}`
              : 'Rituel de pré-vol avant envoi au comptable'
        }
        actions={
          <MonthYearToggle
            period={period}
            month={month}
            onPeriodChange={setPeriod}
            onMonthChange={setMonth}
          />
        }
      />

      {/* Bannière warning souple */}
      {showSoftBanner && (
        <div className="mb-6 rounded-xl bg-warning/10 border border-warning/30 px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={20} className="text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text">
              Check incomplet —{' '}
              {counts.blocking > 0 && (
                <>
                  <span className="text-danger font-semibold">{counts.blocking} bloquant{counts.blocking > 1 ? 's' : ''}</span>
                  {counts.warning > 0 && ', '}
                </>
              )}
              {counts.warning > 0 && (
                <span className="text-warning font-semibold">{counts.warning} à revoir</span>
              )}
              {counts.warning === 0 && counts.blocking === 0 && counts.pending > 0 && (
                <span className="text-text-muted">{counts.pending} en attente</span>
              )}
              .
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              Tu peux envoyer quand même : la décision t'appartient.
            </p>
          </div>
        </div>
      )}

      {/* 4 metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="OK"
          value={String(counts.ok)}
          icon={<CheckCircle2 size={18} />}
          trend="up"
        />
        <MetricCard
          title="À revoir"
          value={String(counts.warning)}
          icon={<AlertTriangle size={18} />}
          className={counts.warning > 0 ? 'ring-1 ring-warning/30' : undefined}
        />
        <MetricCard
          title="Bloquants"
          value={String(counts.blocking)}
          trend={counts.blocking > 0 ? 'down' : undefined}
          className={counts.blocking > 0 ? 'ring-1 ring-danger/30' : undefined}
        />
        <MetricCard
          title="En attente"
          value={String(counts.pending)}
          className={counts.pending > 0 ? 'ring-1 ring-text-muted/30' : undefined}
        />
      </div>

      {/* 8 sections */}
      <div className="space-y-3">
        {instance.sections.map((section, idx) => (
          <CheckSection
            key={section.key}
            section={section}
            index={idx}
            year={selectedYear}
            period={period}
            month={period === 'month' ? month : null}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div className="mt-8 flex items-center justify-between gap-3 sticky bottom-4 bg-background/95 backdrop-blur rounded-xl border border-border px-4 py-3 shadow-md">
        <div className="text-sm text-text-muted">
          {isValidated ? (
            <span className="inline-flex items-center gap-1.5 text-success font-medium">
              <CheckCircle2 size={16} />
              Validé
            </span>
          ) : instance.ready_for_send ? (
            <span className="text-success">Prêt à envoyer</span>
          ) : (
            <span>{counts.blocking + counts.warning} item(s) à traiter avant l'envoi</span>
          )}
        </div>
        <div className="flex gap-2">
          {isValidated ? (
            <button
              onClick={handleUnvalidate}
              disabled={unvalidate.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border hover:bg-surface text-text-muted hover:text-text transition-colors"
            >
              <RotateCcw size={14} />
              Annuler la validation
            </button>
          ) : (
            <button
              onClick={handleValidate}
              disabled={!instance.ready_for_send || validate.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                instance.ready_for_send
                  ? 'bg-success text-white hover:bg-success/90'
                  : 'bg-surface border border-border text-text-muted cursor-not-allowed',
              )}
              title={instance.ready_for_send ? 'Valider ce check' : 'Items bloquants restants'}
            >
              <CheckCircle2 size={14} />
              Valider
            </button>
          )}
          {period === 'month' && (
            <button
              onClick={handlePrepareSend}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              <Send size={14} />
              Préparer l'envoi
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
