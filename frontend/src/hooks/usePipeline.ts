import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useSettings } from './useApi'
import type { PipelineStep, PipelineStepStatus, JustificatifExemptions } from '../types'

// Pondération pour le calcul de progression globale (7 étapes)
// Import, Catég, Justif, Verrouillage, Lettrage, Vérif, Clôture
const STEP_WEIGHTS = [10, 20, 20, 10, 20, 10, 10] // total = 100

const STORAGE_KEY_YEAR = 'pipeline_year'
const STORAGE_KEY_MONTH = 'pipeline_month'

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const n = Number(raw)
      if (!isNaN(n)) return n
    }
  } catch { /* localStorage unavailable */ }
  return fallback
}

interface OperationFile {
  filename: string
  year: number
  month: number
  count: number
}

interface OperationRecord {
  categorie?: string
  'Catégorie'?: string
}

interface ClotureMonth {
  mois: number
  taux_justificatifs?: number
  taux_lettrage?: number
  nb_justificatifs_ok?: number
  nb_justificatifs_total?: number
  nb_lettrees?: number
  nb_operations?: number
  statut?: string
}

interface AlertesSummary {
  par_fichier?: Array<{ filename: string; nb_alertes: number }>
}

function isOpExempt(
  cat: string,
  sub: string,
  exemptions: JustificatifExemptions | undefined,
): boolean {
  if (!exemptions || !cat) return false
  if (exemptions.categories.includes(cat)) return true
  if (sub && exemptions.sous_categories[cat]?.includes(sub)) return true
  return false
}

export function usePipeline() {
  const currentDate = new Date()
  const [year, setYearState] = useState(() => readStoredNumber(STORAGE_KEY_YEAR, currentDate.getFullYear()))
  const [month, setMonthState] = useState(() => readStoredNumber(STORAGE_KEY_MONTH, currentDate.getMonth() + 1))
  const { data: appSettings } = useSettings()
  const exemptions = appSettings?.justificatif_exemptions

  const setYear = useCallback((y: number) => {
    setYearState(y)
    try { localStorage.setItem(STORAGE_KEY_YEAR, String(y)) } catch { /* noop */ }
  }, [])

  const setMonth = useCallback((m: number) => {
    setMonthState(m)
    try { localStorage.setItem(STORAGE_KEY_MONTH, String(m)) } catch { /* noop */ }
  }, [])

  // 1. Liste des fichiers d'opérations
  const filesQuery = useQuery({
    queryKey: ['operations-files'],
    queryFn: () => api.get<OperationFile[]>('/operations/files'),
  })

  // Identifier le fichier du mois sélectionné
  const currentFile = useMemo(() => {
    if (!filesQuery.data) return null
    return filesQuery.data.find(
      (f) => f.year === year && f.month === month
    ) || null
  }, [filesQuery.data, year, month])

  // 2. Charger les opérations du fichier (si existe)
  const operationsQuery = useQuery({
    queryKey: ['operations', currentFile?.filename],
    queryFn: () => api.get<OperationRecord[]>(`/operations/${currentFile!.filename}`),
    enabled: !!currentFile?.filename,
  })

  // 3. Données de clôture pour l'année
  const clotureQuery = useQuery({
    queryKey: ['cloture', year],
    queryFn: () => api.get<ClotureMonth[]>(`/cloture/${year}`),
  })

  // 4. Alertes
  const alertesQuery = useQuery({
    queryKey: ['alertes-summary'],
    queryFn: () => api.get<AlertesSummary>('/alertes/summary'),
  })

  // Données clôture du mois sélectionné
  const clotureMonth = useMemo(() => {
    if (!clotureQuery.data) return null
    return clotureQuery.data.find((m) => m.mois === month) || null
  }, [clotureQuery.data, month])

  // Alertes du fichier courant
  const alertesForFile = useMemo(() => {
    if (!alertesQuery.data || !currentFile) return { count: 0 }
    const fileEntry = (alertesQuery.data.par_fichier || []).find(
      (f) => f.filename === currentFile.filename
    )
    return { count: fileEntry?.nb_alertes || 0 }
  }, [alertesQuery.data, currentFile])

  // Calcul catégorisation
  const categorizationStats = useMemo(() => {
    if (!operationsQuery.data) return { total: 0, categorized: 0, uncategorized: 0, taux: 0 }
    const ops = operationsQuery.data
    const total = ops.length
    const uncategorized = ops.filter(
      (op) => {
        const cat = op.categorie || op['Catégorie'] || ''
        return !cat || cat === 'Autres'
      }
    ).length
    const categorized = total - uncategorized
    return {
      total,
      categorized,
      uncategorized,
      taux: total > 0 ? categorized / total : 0,
    }
  }, [operationsQuery.data])

  // Calcul verrouillage des associations
  // Aligné sur useJustificatifsPage.stats : 1 op = 1 unité, ventilation "avec"
  // ssi toutes les sous-lignes justifiées (every, pas some), exemptions exclues.
  // `locked` = compteur brut des op.locked === true (= pill 🔒 Justificatifs).
  // `taux` = ops associées ET verrouillées / associées (clamp implicite ≤ 100%).
  const lockingStats = useMemo(() => {
    if (!operationsQuery.data) return { associated: 0, locked: 0, taux: 0 }
    const ops = operationsQuery.data as unknown as Array<{
      'Lien justificatif'?: string
      'Catégorie'?: string
      'Sous-catégorie'?: string
      locked?: boolean
      ventilation?: Array<{ justificatif?: string | null }>
    }>
    const hasJustifStrict = (op: typeof ops[number]) => {
      const vl = op.ventilation || []
      if (vl.length > 0) return vl.every(v => !!v.justificatif)
      return !!(op['Lien justificatif'] || '').trim()
    }
    const exempt = (op: typeof ops[number]) =>
      isOpExempt((op['Catégorie'] || '').trim(), (op['Sous-catégorie'] || '').trim(), exemptions)

    const associatedOps = ops.filter(op => !exempt(op) && hasJustifStrict(op))
    const associated = associatedOps.length
    // Compteur brut aligné avec la pill JustificatifsPage (toutes les locked, même
    // sans justif — signal d'écart visible si locked > associated)
    const locked = ops.filter(op => op.locked === true).length
    const lockedInAssociated = associatedOps.filter(op => op.locked === true).length
    const lockedOrphans = locked - lockedInAssociated
    return {
      associated,
      locked,
      lockedInAssociated,
      lockedOrphans,
      taux: associated > 0 ? lockedInAssociated / associated : 0,
    }
  }, [operationsQuery.data, exemptions])

  // Années disponibles (extraites des fichiers)
  const availableYears = useMemo(() => {
    if (!filesQuery.data) return [currentDate.getFullYear()]
    const years = [...new Set(filesQuery.data.map((f) => f.year))]
    return years.sort((a, b) => b - a)
  }, [filesQuery.data])

  // Construire les 7 étapes
  const steps: PipelineStep[] = useMemo(() => {
    // --- ÉTAPE 1 : Import ---
    const step1Status: PipelineStepStatus = currentFile ? 'complete' : 'not_started'
    const step1Progress = currentFile ? 100 : 0

    // --- ÉTAPE 2 : Catégorisation ---
    const step2Progress = Math.round(categorizationStats.taux * 100)
    const step2Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      step2Progress === 100 ? 'complete' :
      step2Progress > 0 ? 'in_progress' : 'not_started'

    // --- ÉTAPE 3 : Justificatifs ---
    const tauxJustificatifs = clotureMonth?.taux_justificatifs ?? 0
    const step3Progress = Math.round(tauxJustificatifs * 100)
    const step3Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      step3Progress === 100 ? 'complete' :
      step3Progress > 0 ? 'in_progress' : 'not_started'

    // --- ÉTAPE 4 : Rapprochement ---
    const tauxLettrage = clotureMonth?.taux_lettrage ?? 0
    const step4Progress = Math.round(tauxLettrage * 100)
    const step4Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      step4Progress === 100 ? 'complete' :
      step4Progress > 0 ? 'in_progress' : 'not_started'

    // --- ÉTAPE 5 : Vérification ---
    const nbAlertes = alertesForFile.count
    const step5Progress = !currentFile ? 0 : nbAlertes === 0 ? 100 : Math.max(0, 100 - nbAlertes * 5)
    const step5Status: PipelineStepStatus =
      !currentFile ? 'not_started' :
      nbAlertes === 0 ? 'complete' : 'in_progress'

    // --- ÉTAPE 6 : Clôture ---
    const statut = clotureMonth?.statut ?? 'manquant'
    const step6Progress = statut === 'complet' ? 100 : statut === 'partiel' ? 50 : 0
    const step6Status: PipelineStepStatus =
      statut === 'complet' ? 'complete' :
      statut === 'partiel' ? 'in_progress' : 'not_started'

    // Construire les routes avec le fichier du mois sélectionné
    const fileParam = currentFile ? `file=${encodeURIComponent(currentFile.filename)}` : ''

    return [
      {
        id: 'import',
        number: 1,
        title: 'Import du relevé bancaire',
        description: 'Importer le relevé PDF du mois. Le système extrait automatiquement les opérations et détecte les doublons.',
        status: step1Status,
        progress: step1Progress,
        metrics: [
          {
            label: 'Relevé',
            value: currentFile ? 'Importé' : 'Manquant',
            variant: currentFile ? 'success' : 'danger',
          },
          ...(currentFile ? [{
            label: 'Opérations extraites',
            value: currentFile.count,
            variant: 'default' as const,
          }] : []),
        ],
        actionLabel: currentFile ? 'Voir les opérations' : 'Importer un relevé',
        actionRoute: currentFile ? `/editor?${fileParam}` : '/import',
      },
      {
        id: 'categorization',
        number: 2,
        title: 'Catégorisation des opérations',
        description: 'Vérifier et corriger les catégories attribuées par l\'IA. Les opérations sans catégorie ou classées "Autres" nécessitent une revue manuelle.',
        status: step2Status,
        progress: step2Progress,
        metrics: [
          {
            label: 'Catégorisées',
            value: categorizationStats.categorized,
            total: categorizationStats.total,
            variant: step2Progress === 100 ? 'success' : step2Progress > 50 ? 'warning' : 'danger',
          },
          {
            label: 'À traiter',
            value: categorizationStats.uncategorized,
            variant: categorizationStats.uncategorized === 0 ? 'success' : 'warning',
          },
        ],
        actionLabel: 'Ouvrir l\'éditeur',
        actionRoute: fileParam ? `/editor?${fileParam}&filter=uncategorized` : '/editor?filter=uncategorized',
      },
      {
        id: 'justificatifs',
        number: 3,
        title: 'Justificatifs & OCR',
        description: 'Scanner et associer les justificatifs (factures, reçus) aux opérations. L\'OCR extrait automatiquement montant, date et fournisseur.',
        status: step3Status,
        progress: step3Progress,
        metrics: [
          {
            label: 'Taux justificatifs',
            value: `${step3Progress}%`,
            variant: step3Progress === 100 ? 'success' : step3Progress > 50 ? 'warning' : 'danger',
          },
          {
            label: 'Avec justificatif',
            value: clotureMonth?.nb_justificatifs_ok ?? 0,
            total: clotureMonth?.nb_justificatifs_total ?? 0,
            variant: 'default',
          },
        ],
        actionLabel: 'Upload & OCR',
        actionRoute: '/ocr',
        secondaryActions: [{ label: 'Voir justificatifs', route: fileParam ? `/justificatifs?${fileParam}` : '/justificatifs' }],
      },
      {
        id: 'verrouillage',
        number: 4,
        title: 'Verrouillage des associations',
        description: 'Verrouiller les justificatifs attribués pour qu\'ils soient protégés contre l\'écrasement par le rapprochement automatique. Chaque nouvelle association manuelle verrouille automatiquement — il reste à traiter les associations historiques faites avant cette feature.',
        status: (() => {
          if (!currentFile) return 'not_started' as PipelineStepStatus
          if (lockingStats.associated === 0) return 'not_started' as PipelineStepStatus
          if (lockingStats.taux >= 1) return 'complete' as PipelineStepStatus
          if (lockingStats.locked > 0) return 'in_progress' as PipelineStepStatus
          return 'not_started' as PipelineStepStatus
        })(),
        progress: Math.round(lockingStats.taux * 100),
        metrics: [
          {
            label: 'Taux verrouillage',
            value: `${Math.round(lockingStats.taux * 100)}%`,
            variant: lockingStats.taux >= 1 ? 'success' : lockingStats.taux > 0.5 ? 'warning' : 'danger',
          },
          {
            label: 'Verrouillées',
            value: lockingStats.lockedInAssociated,
            total: lockingStats.associated,
            variant: 'default',
          },
          // Signal optionnel : ops verrouillées qui n'ont plus de justif
          // (legacy auto-lock cascade, dissociation post-lock, etc.).
          // Visible uniquement si > 0 — sinon on n'encombre pas la card.
          ...(lockingStats.lockedOrphans > 0 ? [{
            label: 'Lockées sans justif',
            value: lockingStats.lockedOrphans,
            variant: 'warning' as const,
          }] : []),
        ],
        actionLabel: 'Voir les associations',
        actionRoute: fileParam ? `/justificatifs?${fileParam}&filter=avec` : '/justificatifs?filter=avec',
      },
      {
        id: 'lettrage',
        number: 5,
        title: 'Lettrage des opérations',
        description: 'Pointer les opérations en les associant aux justificatifs correspondants. Le rapprochement auto gère les cas évidents.',
        status: step4Status,
        progress: step4Progress,
        metrics: [
          {
            label: 'Taux lettrage',
            value: `${step4Progress}%`,
            variant: step4Progress === 100 ? 'success' : step4Progress > 50 ? 'warning' : 'danger',
          },
          {
            label: 'Lettrées',
            value: clotureMonth?.nb_lettrees ?? 0,
            total: clotureMonth?.nb_operations ?? 0,
            variant: 'default',
          },
        ],
        actionLabel: 'Justificatifs',
        actionRoute: fileParam ? `/justificatifs?${fileParam}` : '/justificatifs',
      },
      {
        id: 'verification',
        number: 6,
        title: 'Vérification & alertes',
        description: 'Traiter les alertes du compte d\'attente : justificatifs manquants, opérations non catégorisées, montants suspects, doublons potentiels.',
        status: step5Status,
        progress: step5Progress,
        metrics: [
          {
            label: 'Alertes restantes',
            value: nbAlertes,
            variant: nbAlertes === 0 ? 'success' : nbAlertes <= 5 ? 'warning' : 'danger',
          },
        ],
        actionLabel: 'Voir les alertes',
        actionRoute: '/alertes',
      },
      {
        id: 'cloture',
        number: 7,
        title: 'Clôture & export',
        description: 'Finaliser le mois : vérifier que lettrage et justificatifs sont à 100%, puis générer l\'archive comptable ZIP.',
        status: step6Status,
        progress: step6Progress,
        metrics: [
          {
            label: 'Statut',
            value: statut === 'complet' ? 'Complet' : statut === 'partiel' ? 'Partiel' : 'Manquant',
            variant: statut === 'complet' ? 'success' : statut === 'partiel' ? 'warning' : 'danger',
          },
        ],
        actionLabel: 'Exporter',
        actionRoute: '/export',
        secondaryActions: [{ label: 'Vue clôture', route: '/cloture' }],
      },
    ]
  }, [currentFile, categorizationStats, lockingStats, clotureMonth, alertesForFile])

  // Progression globale pondérée
  const globalProgress = useMemo(() => {
    return Math.round(
      steps.reduce((acc, step, i) => acc + step.progress * STEP_WEIGHTS[i], 0) / 100
    )
  }, [steps])

  // Badges pour les 12 mois (progression simplifiée depuis clôture + fichiers)
  const monthBadges = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const clMonth = clotureQuery.data?.find((c) => c.mois === m) ?? null
      const hasFile = filesQuery.data?.some((f) => f.year === year && f.month === m) ?? false

      if (!hasFile && !clMonth) {
        return { month: m, progress: 0, status: 'not_started' as PipelineStepStatus }
      }

      const importPct = hasFile ? 100 : 0
      const justPct = Math.round((clMonth?.taux_justificatifs ?? 0) * 100)
      const letPct = Math.round((clMonth?.taux_lettrage ?? 0) * 100)
      const statut = clMonth?.statut ?? 'manquant'
      const cloturePct = statut === 'complet' ? 100 : statut === 'partiel' ? 50 : 0

      // Simplified weighted average (import 15%, justificatifs 30%, lettrage 30%, clôture 25%)
      const progress = Math.round(importPct * 0.15 + justPct * 0.30 + letPct * 0.30 + cloturePct * 0.25)

      const status: PipelineStepStatus =
        progress === 100 ? 'complete' :
        progress > 0 ? 'in_progress' : 'not_started'

      return { month: m, progress, status }
    })
  }, [clotureQuery.data, filesQuery.data, year])

  const isLoading = filesQuery.isLoading || clotureQuery.isLoading || alertesQuery.isLoading

  return {
    year,
    setYear,
    month,
    setMonth,
    availableYears,
    steps,
    globalProgress,
    monthBadges,
    isLoading,
    currentFile,
  }
}
