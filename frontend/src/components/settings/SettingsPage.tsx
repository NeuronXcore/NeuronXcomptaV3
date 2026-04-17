import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import JustificatifExemptionsSection from './JustificatifExemptionsSection'
import { useSettings, useRestartBackend } from '@/hooks/useApi'
import { useScanLinks, useRepairLinks } from '@/hooks/useJustificatifs'
import { api } from '@/api/client'
import { cn, MOIS_FR } from '@/lib/utils'
import type { AppSettings } from '@/types'
import {
  Settings, Palette, FileText, HardDrive, Server, Save,
  Loader2, Check, Moon, Sun, Bell, BellOff, Eye, EyeOff,
  FolderOpen, Database, Paperclip, Brain, ScrollText,
  Archive, Clock, Info, Monitor, Pencil, Trash2, X, ChevronDown,
  Mail, CheckCircle2, Send, FileCheck, ShieldCheck, AlertTriangle, RefreshCw,
  Power, Inbox,
} from 'lucide-react'
import EmailChipsInput from '@/components/common/EmailChipsInput'
import { useTestEmailConnection } from '@/hooks/useEmail'
import toast from 'react-hot-toast'

type Tab = 'general' | 'theme' | 'export' | 'justificatifs' | 'storage' | 'system' | 'email'

interface DiskSpace {
  total_gb: number
  used_gb: number
  free_gb: number
  percent_used: number
}

interface FolderStat {
  count: number
  size: number
  size_human: string
}

interface DataStats {
  imports: FolderStat
  exports: FolderStat
  reports: FolderStat
  justificatifs_en_attente: FolderStat
  justificatifs_traites: FolderStat
  ml: FolderStat
  logs: FolderStat
}

interface SystemInfo {
  app_name: string
  app_version: string
  python_version: string
  platform: string
  machine: string
  data_dir: string
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  const tabs: { key: Tab; label: string; icon: typeof Settings }[] = [
    { key: 'general', label: 'Général', icon: Settings },
    { key: 'theme', label: 'Interface', icon: Palette },
    { key: 'export', label: 'Exportation', icon: FileText },
    { key: 'justificatifs', label: '\ud83d\ude08 Batch fac-simile', icon: FileCheck },
    { key: 'storage', label: 'Stockage', icon: HardDrive },
    { key: 'system', label: 'Système', icon: Server },
    { key: 'email', label: 'Email', icon: Mail },
  ]

  return (
    <div className="p-6">
      <PageHeader
        title="Paramètres"
        description="Configuration de l'application NeuronXcompta"
      />

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <div className="shrink-0 w-48">
          <nav className="sticky top-6 space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left',
                  activeTab === tab.key
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-text-muted hover:text-text hover:bg-surface-hover'
                )}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'theme' && <ThemeTab />}
          {activeTab === 'export' && <ExportTab />}
          {activeTab === 'justificatifs' && <JustificatifsTab />}
          {activeTab === 'storage' && <StorageTab />}
          {activeTab === 'system' && <SystemTab />}
          {activeTab === 'email' && <EmailTab />}
        </div>
      </div>
    </div>
  )
}


// ──── Settings form wrapper ────

function useSettingsForm() {
  const { data: settings, isLoading } = useSettings()
  const queryClient = useQueryClient()
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings && !localSettings) {
      setLocalSettings(settings)
    }
  }, [settings, localSettings])

  const saveMutation = useMutation({
    mutationFn: (s: AppSettings) => api.put('/settings', s),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!localSettings) return
    setLocalSettings({ ...localSettings, [key]: value })
    setSaved(false)
  }

  const updateTheme = (key: string, value: string) => {
    if (!localSettings) return
    setLocalSettings({
      ...localSettings,
      theme_settings: { ...localSettings.theme_settings, [key]: value },
    })
    setSaved(false)
  }

  const save = () => {
    if (localSettings) saveMutation.mutate(localSettings)
  }

  return { settings: localSettings, isLoading, update, updateTheme, save, saving: saveMutation.isPending, saved }
}

function SaveButton({ onSave, saving, saved }: { onSave: () => void; saving: boolean; saved: boolean }) {
  return (
    <button
      onClick={onSave}
      disabled={saving}
      className={cn(
        'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all',
        saved
          ? 'bg-success/20 text-success'
          : 'bg-primary text-white hover:bg-primary-dark shadow-lg shadow-primary/25'
      )}
    >
      {saving ? (
        <><Loader2 size={15} className="animate-spin" /> Sauvegarde...</>
      ) : saved ? (
        <><Check size={15} /> Sauvegardé</>
      ) : (
        <><Save size={15} /> Sauvegarder</>
      )}
    </button>
  )
}


// ──── General Tab ────

function GeneralTab() {
  const { settings, isLoading, update, save, saving, saved } = useSettingsForm()

  if (isLoading || !settings) return <LoadingSpinner text="Chargement..." />

  return (
    <div className="space-y-8">
      <div className="bg-surface rounded-2xl border border-border p-6 space-y-8">
        <h3 className="font-semibold text-text flex items-center gap-2 text-base">
          <Settings size={18} />
          Paramètres généraux
        </h3>

        {/* Dark mode */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.dark_mode ? <Moon size={18} className="text-primary" /> : <Sun size={18} className="text-warning" />}
            <div>
              <p className="text-sm font-medium text-text">Mode sombre</p>
              <p className="text-xs text-text-muted">Thème sombre pour réduire la fatigue oculaire</p>
            </div>
          </div>
          <ToggleSwitch checked={settings.dark_mode} onChange={v => update('dark_mode', v)} />
        </div>

        {/* Notifications */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.notifications ? <Bell size={18} className="text-primary" /> : <BellOff size={18} className="text-text-muted" />}
            <div>
              <p className="text-sm font-medium text-text">Notifications</p>
              <p className="text-xs text-text-muted">Alertes et messages de l'application</p>
            </div>
          </div>
          <ToggleSwitch checked={settings.notifications} onChange={v => update('notifications', v)} />
        </div>

        {/* Num operations */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Eye size={18} className="text-primary" />
            <div>
              <p className="text-sm font-medium text-text">Opérations par page</p>
              <p className="text-xs text-text-muted">Nombre d'opérations affichées dans l'éditeur</p>
            </div>
          </div>
          <div className="flex items-center gap-4 ml-8">
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={settings.num_operations}
              onChange={e => update('num_operations', Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-mono text-text w-12 text-right">{settings.num_operations}</span>
          </div>
        </div>

        {/* ML retrain thresholds — alerte "Réentraîner le modèle IA" (tâche auto + toast) */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center gap-3 mb-3">
            <Brain size={18} className="text-primary" />
            <div>
              <p className="text-sm font-medium text-text">Réentraînement ML — seuils</p>
              <p className="text-xs text-text-muted">
                Déclenche la tâche auto &quot;Réentraîner le modèle IA&quot; (+ toast au montage) selon :
                <br />
                <span className="text-text-muted/80">
                  corrections ≥ seuil <em>ou</em> (corrections ≥ 1 <em>et</em> jours ≥ seuil)
                </span>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 ml-8">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-text-muted">Corrections min.</span>
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={settings.ml_retrain_corrections_threshold ?? 10}
                onChange={e => update('ml_retrain_corrections_threshold', Math.max(1, Number(e.target.value) || 10))}
                className="bg-background border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-text-muted">Jours sans entraînement min.</span>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                value={settings.ml_retrain_days_threshold ?? 14}
                onChange={e => update('ml_retrain_days_threshold', Math.max(1, Number(e.target.value) || 14))}
                className="bg-background border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              />
            </label>
          </div>
        </div>

        {/* Sandbox — mode de traitement */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center gap-3 mb-3">
            <Inbox size={18} className="text-primary" />
            <div>
              <p className="text-sm font-medium text-text">Sandbox — Mode de traitement</p>
              <p className="text-xs text-text-muted">
                Les fichiers <em>canoniques</em> (<code>fournisseur_YYYYMMDD_montant.XX.pdf</code>) sont toujours traités immédiatement.
                Les <em>non-canoniques</em> attendent dans la boîte d'arrivée (/ocr → Sandbox).
              </p>
            </div>
          </div>
          <div className="ml-8 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text">OCR automatique après délai</p>
                <p className="text-xs text-text-muted">
                  Déclenche l'OCR automatiquement pour les fichiers arrivés depuis plus de N secondes.
                </p>
              </div>
              <ToggleSwitch
                checked={settings.sandbox_auto_mode ?? false}
                onChange={v => update('sandbox_auto_mode', v)}
              />
            </div>
            {settings.sandbox_auto_mode && (
              <div>
                <p className="text-sm text-text mb-2">Délai avant OCR auto</p>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={15}
                    max={300}
                    step={15}
                    value={settings.sandbox_auto_delay_seconds ?? 30}
                    onChange={e => update('sandbox_auto_delay_seconds', Number(e.target.value))}
                    className="flex-1 accent-amber-500"
                  />
                  <span className="text-sm font-mono text-amber-400 w-16 text-right tabular-nums">
                    {(settings.sandbox_auto_delay_seconds ?? 30) < 60
                      ? `${settings.sandbox_auto_delay_seconds ?? 30}s`
                      : `${Math.round((settings.sandbox_auto_delay_seconds ?? 30) / 60)}min`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <SaveButton onSave={save} saving={saving} saved={saved} />
      </div>
    </div>
  )
}


// ──── Theme Tab ────

function ThemeTab() {
  const { settings, isLoading, updateTheme, save, saving, saved } = useSettingsForm()

  if (isLoading || !settings) return <LoadingSpinner text="Chargement..." />

  const colors = [
    { key: 'primary_color', label: 'Couleur principale', desc: 'Boutons, liens et accents', current: settings.theme_settings.primary_color },
    { key: 'background_color', label: 'Couleur de fond', desc: 'Arrière-plan secondaire', current: settings.theme_settings.background_color },
    { key: 'text_color', label: 'Couleur du texte', desc: 'Texte principal', current: settings.theme_settings.text_color },
  ]

  const presets = [
    { name: 'Violet', primary: '#811971', bg: '#cccce2', text: '#f1efe8' },
    { name: 'Bleu', primary: '#2563eb', bg: '#dbeafe', text: '#1e3a5f' },
    { name: 'Vert', primary: '#059669', bg: '#d1fae5', text: '#064e3b' },
    { name: 'Orange', primary: '#ea580c', bg: '#fed7aa', text: '#431407' },
    { name: 'Rose', primary: '#db2777', bg: '#fce7f3', text: '#831843' },
  ]

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-2xl border border-border p-6 space-y-6">
        <h3 className="font-semibold text-text flex items-center gap-2">
          <Palette size={18} />
          Personnalisation de l'interface
        </h3>

        {/* Color pickers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {colors.map(c => (
            <div key={c.key} className="bg-background rounded-xl p-4">
              <label className="text-xs font-medium text-text-muted block mb-2">{c.label}</label>
              <p className="text-[10px] text-text-muted mb-3">{c.desc}</p>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input
                    type="color"
                    value={c.current}
                    onChange={e => updateTheme(c.key, e.target.value)}
                    className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                  />
                </div>
                <input
                  type="text"
                  value={c.current}
                  onChange={e => updateTheme(c.key, e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Presets */}
        <div>
          <p className="text-xs font-medium text-text-muted mb-3">Thèmes prédéfinis</p>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p.name}
                onClick={() => {
                  updateTheme('primary_color', p.primary)
                  updateTheme('background_color', p.bg)
                  updateTheme('text_color', p.text)
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border hover:border-primary/50 transition-colors bg-background"
              >
                <div className="flex gap-0.5">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.primary }} />
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.bg }} />
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.text }} />
                </div>
                <span className="text-xs text-text">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div>
          <p className="text-xs font-medium text-text-muted mb-3">Aperçu</p>
          <div
            className="rounded-xl p-5 border"
            style={{ backgroundColor: settings.theme_settings.background_color, borderColor: settings.theme_settings.primary_color + '40' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: settings.theme_settings.primary_color }}>
                <Settings size={14} color="white" />
              </div>
              <p className="text-sm font-semibold" style={{ color: settings.theme_settings.text_color }}>
                NeuronXcompta
              </p>
            </div>
            <p className="text-xs mb-3" style={{ color: settings.theme_settings.text_color + 'aa' }}>
              Aperçu de votre thème personnalisé
            </p>
            <button
              className="px-4 py-1.5 rounded-lg text-white text-xs font-medium"
              style={{ backgroundColor: settings.theme_settings.primary_color }}
            >
              Bouton exemple
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <SaveButton onSave={save} saving={saving} saved={saved} />
      </div>
    </div>
  )
}


// ──── Export Tab ────

function ExportTab() {
  const { settings, isLoading, update, save, saving, saved } = useSettingsForm()

  if (isLoading || !settings) return <LoadingSpinner text="Chargement..." />

  const formats = [
    { id: 'CSV', label: 'CSV', desc: 'Tableur simple compatible Excel', icon: FileText, color: 'text-success' },
    { id: 'PDF', label: 'PDF', desc: 'Document mis en forme pour impression', icon: FileText, color: 'text-danger' },
  ]

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-2xl border border-border p-6 space-y-6">
        <h3 className="font-semibold text-text flex items-center gap-2">
          <FileText size={18} />
          Paramètres d'exportation
        </h3>

        {/* Default format */}
        <div>
          <p className="text-sm font-medium text-text mb-3">Format par défaut</p>
          <div className="space-y-2">
            {formats.map(fmt => (
              <label
                key={fmt.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border',
                  settings.export_format === fmt.id
                    ? 'bg-primary/10 border-primary/30'
                    : 'border-transparent bg-background hover:border-border'
                )}
              >
                <input
                  type="radio"
                  name="export_format"
                  value={fmt.id}
                  checked={settings.export_format === fmt.id}
                  onChange={() => update('export_format', fmt.id)}
                  className="accent-primary"
                />
                <fmt.icon size={16} className={fmt.color} />
                <div>
                  <p className="text-sm text-text">{fmt.label}</p>
                  <p className="text-[10px] text-text-muted">{fmt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">Inclure les graphiques</p>
              <p className="text-xs text-text-muted">Ajouter des visualisations aux rapports</p>
            </div>
            <ToggleSwitch checked={settings.include_graphs} onChange={v => update('include_graphs', v)} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">Compresser les exports</p>
              <p className="text-xs text-text-muted">Réduire la taille des fichiers exportés</p>
            </div>
            <ToggleSwitch checked={settings.compress_exports} onChange={v => update('compress_exports', v)} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <SaveButton onSave={save} saving={saving} saved={saved} />
      </div>
    </div>
  )
}


// ──── Storage Tab ────

interface OperationFile {
  filename: string
  count: number
  total_debit?: number
  total_credit?: number
  month?: number
  year?: number
}

// ──── Justificatifs Tab ────

function JustificatifsTab() {
  const { settings, isLoading, update, save, saving, saved } = useSettingsForm()

  if (isLoading || !settings) return <LoadingSpinner text="Chargement..." />

  return (
    <div className="space-y-8">
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h3 className="font-semibold text-text flex items-center gap-2 text-base mb-1">
          <FileCheck size={18} />
          Batch fac-simile
        </h3>
        <p className="text-xs text-text-muted mb-4">Configurez les categories exemptees de justificatif. Les operations de ces categories ne genereront pas d'alerte et seront considerees comme couvertes.</p>

        <JustificatifExemptionsSection
          exemptions={settings.justificatif_exemptions || { categories: ['Perso'], sous_categories: {} }}
          onChange={(v) => update('justificatif_exemptions', v)}
        />
      </div>

      <div className="flex justify-end">
        <SaveButton onSave={save} saving={saving} saved={saved} />
      </div>
    </div>
  )
}


// ──── Storage Tab ────

function StorageTab() {
  const queryClient = useQueryClient()

  const { data: diskSpace } = useQuery<DiskSpace>({
    queryKey: ['disk-space'],
    queryFn: () => api.get('/settings/disk-space'),
  })

  const { data: dataStats, isLoading } = useQuery<DataStats>({
    queryKey: ['data-stats'],
    queryFn: () => api.get('/settings/data-stats'),
  })

  const { data: operationFiles = [] } = useQuery<OperationFile[]>({
    queryKey: ['operation-files'],
    queryFn: () => api.get('/operations/files'),
  })

  // Rename state
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  // Delete confirm state
  const [deletingFile, setDeletingFile] = useState<string | null>(null)

  const renameMutation = useMutation({
    mutationFn: ({ filename, new_filename }: { filename: string; new_filename: string }) =>
      api.patch(`/operations/${encodeURIComponent(filename)}/rename`, { new_filename }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operation-files'] })
      queryClient.invalidateQueries({ queryKey: ['data-stats'] })
      setRenamingFile(null)
      setNewName('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (filename: string) =>
      api.delete(`/operations/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operation-files'] })
      queryClient.invalidateQueries({ queryKey: ['data-stats'] })
      queryClient.invalidateQueries({ queryKey: ['disk-space'] })
      setDeletingFile(null)
    },
  })

  const startRename = (filename: string) => {
    setRenamingFile(filename)
    setNewName(filename)
    setDeletingFile(null)
  }

  const confirmRename = () => {
    if (!renamingFile || !newName.trim()) return
    const finalName = newName.endsWith('.json') ? newName : `${newName}.json`
    renameMutation.mutate({ filename: renamingFile, new_filename: finalName })
  }

  const confirmDelete = (filename: string) => {
    deleteMutation.mutate(filename)
  }

  if (isLoading) return <LoadingSpinner text="Analyse du stockage..." />

  const folders = dataStats ? [
    { label: 'Imports (relevés)', icon: FolderOpen, ...dataStats.imports, color: 'text-info' },
    { label: 'Exports', icon: Archive, ...dataStats.exports, color: 'text-primary' },
    { label: 'Rapports', icon: FileText, ...dataStats.reports, color: 'text-success' },
    { label: 'Justificatifs (attente)', icon: Paperclip, ...dataStats.justificatifs_en_attente, color: 'text-amber-400' },
    { label: 'Justificatifs (traités)', icon: Paperclip, ...dataStats.justificatifs_traites, color: 'text-emerald-400' },
    { label: 'Modèles ML', icon: Brain, ...dataStats.ml, color: 'text-danger' },
    { label: 'Logs', icon: ScrollText, ...dataStats.logs, color: 'text-text-muted' },
  ] : []

  const totalDataSize = folders.reduce((s, f) => s + f.size, 0)

  return (
    <div className="space-y-6">
      {/* Disk space */}
      {diskSpace && (
        <div className="bg-surface rounded-2xl border border-border p-6">
          <h3 className="font-semibold text-text flex items-center gap-2 mb-4">
            <HardDrive size={18} />
            Espace disque
          </h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-text">{diskSpace.total_gb} Go</p>
              <p className="text-xs text-text-muted">Total</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{diskSpace.used_gb} Go</p>
              <p className="text-xs text-text-muted">Utilisé</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{diskSpace.free_gb} Go</p>
              <p className="text-xs text-text-muted">Libre</p>
            </div>
          </div>

          <div className="w-full h-3 bg-background rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                diskSpace.percent_used >= 90 ? 'bg-danger' :
                diskSpace.percent_used >= 70 ? 'bg-warning' : 'bg-primary'
              )}
              style={{ width: `${diskSpace.percent_used}%` }}
            />
          </div>
          <p className="text-xs text-text-muted mt-2 text-right">{diskSpace.percent_used}% utilisé</p>
        </div>
      )}

      {/* Folder breakdown */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text flex items-center gap-2">
            <Database size={18} />
            Répartition des données
          </h3>
          <span className="text-xs text-text-muted">
            Total : {totalDataSize < 1024 * 1024
              ? `${(totalDataSize / 1024).toFixed(0)} Ko`
              : `${(totalDataSize / 1024 / 1024).toFixed(1)} Mo`
            }
          </span>
        </div>

        <div className="space-y-2">
          {folders.map((f, i) => {
            const pct = totalDataSize > 0 ? (f.size / totalDataSize * 100) : 0
            return (
              <div key={i} className="flex items-center gap-3 bg-background rounded-xl p-3">
                <f.icon size={16} className={f.color} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-text">{f.label}</p>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span>{f.count} fichier{f.count > 1 ? 's' : ''}</span>
                      <span className="font-mono">{f.size_human}</span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60 rounded-full"
                      style={{ width: `${Math.max(pct, 0.5)}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Intégrité des liens justificatifs */}
      <JustificatifsIntegritySection />

      {/* Operation files management — grouped by year */}
      <OperationFilesSection
        operationFiles={operationFiles}
        renamingFile={renamingFile}
        newName={newName}
        setNewName={setNewName}
        deletingFile={deletingFile}
        setDeletingFile={setDeletingFile}
        startRename={startRename}
        confirmRename={confirmRename}
        confirmDelete={confirmDelete}
        renameMutation={renameMutation}
        deleteMutation={deleteMutation}
        setRenamingFile={setRenamingFile}
      />
    </div>
  )
}


// ──── Justificatifs integrity — scan & repair ────

function JustificatifsIntegritySection() {
  const scan = useScanLinks()
  const repair = useRepairLinks()
  const restart = useRestartBackend()
  const data = scan.data

  const handleScan = () => {
    scan.refetch()
  }

  const handleRepair = async () => {
    try {
      const result = await repair.mutateAsync()
      const total =
        result.deleted_from_attente +
        result.moved_to_traites +
        result.deleted_from_traites +
        result.moved_to_attente +
        result.ghost_refs_cleared
      if (total > 0) {
        toast.success(`${total} action(s) appliquée(s)`)
      } else {
        toast('Aucune action appliquée', { icon: 'ℹ️' })
      }
      if (result.conflicts_skipped > 0) {
        toast(`${result.conflicts_skipped} conflit(s) skippé(s)`, { icon: '⚠️' })
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} erreur(s)`)
      }
      // Re-scan pour rafraîchir l'état
      scan.refetch()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur réparation')
    }
  }

  const handleRestart = async () => {
    const confirmed = window.confirm(
      "Redémarrer le backend ?\n\nLe serveur sera relancé (~3s), la page se rechargera ensuite automatiquement. Utile pour rejouer la réparation au boot ou recharger la config."
    )
    if (!confirmed) return
    try {
      await restart.mutateAsync()
      // Si on arrive ici c'est que le hard reload n'a pas encore eu lieu
      toast.success('Backend redémarré')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur redémarrage')
    }
  }

  const totalFixable = data
    ? data.duplicates_to_delete_attente.length +
      data.misplaced_to_move_to_traites.length +
      data.orphans_to_delete_traites.length +
      data.orphans_to_move_to_attente.length +
      data.reconnectable_ventilation.length +
      data.ghost_refs.length
    : 0

  return (
    <div className="bg-surface rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-text flex items-center gap-2">
          <ShieldCheck size={18} />
          Intégrité des justificatifs
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scan.isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-background hover:bg-border rounded-lg border border-border text-text transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={cn(scan.isFetching && 'animate-spin')} />
            {scan.isFetching ? 'Scan…' : 'Scanner'}
          </button>
          <button
            onClick={handleRestart}
            disabled={restart.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-warning/15 hover:bg-warning/25 rounded-lg border border-warning/40 text-warning transition-colors disabled:opacity-50"
            title="Redémarre le backend (dev) pour rejouer la réparation au boot. La page se rechargera automatiquement."
          >
            <Power size={12} className={cn(restart.isPending && 'animate-spin')} />
            {restart.isPending ? 'Redémarrage…' : 'Redémarrer backend'}
          </button>
        </div>
      </div>

      <p className="text-xs text-text-muted mb-4">
        Détecte duplicatas, orphelins, fichiers déplacés et liens cassés entre{' '}
        <code className="bg-background px-1 rounded">en_attente/</code> et{' '}
        <code className="bg-background px-1 rounded">traites/</code>. La
        réparation est appliquée automatiquement au démarrage du backend, ce
        bouton permet de la lancer à la demande.
      </p>

      {!data && !scan.isFetching && (
        <div className="text-xs text-text-muted italic">
          Clique sur « Scanner » pour lancer l'audit.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            <IntegrityMetric
              label="Duplicatas en_attente"
              value={data.duplicates_to_delete_attente.length}
              hint="Copies fantômes à supprimer"
            />
            <IntegrityMetric
              label="Fichiers mal placés"
              value={data.misplaced_to_move_to_traites.length}
              hint="en_attente/ → traites/"
            />
            <IntegrityMetric
              label="Orphelins duplicatas"
              value={data.orphans_to_delete_traites.length}
              hint="traites/ à supprimer"
            />
            <IntegrityMetric
              label="Orphelins à déplacer"
              value={data.orphans_to_move_to_attente.length}
              hint="traites/ → en_attente/"
            />
            <IntegrityMetric
              label="Ventilation à reconnecter"
              value={data.reconnectable_ventilation.length}
              hint="Sous-ligne vide ↔ orphan"
            />
            <IntegrityMetric
              label="Liens fantômes"
              value={data.ghost_refs.length}
              hint="Ops → fichier inexistant"
            />
            <IntegrityMetric
              label="Conflits hashs"
              value={data.hash_conflicts.length}
              hint="Skippés à l'apply"
              warning
            />
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-border">
            <button
              onClick={handleRepair}
              disabled={totalFixable === 0 || repair.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {repair.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              Réparer {totalFixable > 0 && `(${totalFixable} action${totalFixable > 1 ? 's' : ''})`}
            </button>
            <span className="text-xs text-text-muted">
              {data.scanned.traites} traités · {data.scanned.attente} en attente · {data.scanned.op_refs} liens op
            </span>
          </div>

          {data.hash_conflicts.length > 0 && (
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-warning flex items-center gap-1.5 hover:text-warning/80">
                <AlertTriangle size={12} />
                {data.hash_conflicts.length} conflit{data.hash_conflicts.length > 1 ? 's' : ''} — inspection manuelle requise
              </summary>
              <ul className="mt-2 space-y-1 pl-5">
                {data.hash_conflicts.map((c) => (
                  <li key={c.name} className="font-mono text-text-muted">
                    {c.name}
                    <span className="ml-2 text-[10px]">
                      (attente={c.hash_attente.slice(0, 8)} vs traites={c.hash_traites.slice(0, 8)})
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function IntegrityMetric({
  label,
  value,
  hint,
  warning,
}: {
  label: string
  value: number
  hint: string
  warning?: boolean
}) {
  return (
    <div
      className={cn(
        'bg-background rounded-xl p-3 border',
        value === 0
          ? 'border-border text-text-muted'
          : warning
          ? 'border-warning/30 text-warning'
          : 'border-primary/30 text-primary',
      )}
    >
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[11px] text-text mt-0.5">{label}</div>
      <div className="text-[10px] text-text-muted">{hint}</div>
    </div>
  )
}


// ──── Operation Files Section (accordion by year) ────

function OperationFilesSection({
  operationFiles,
  renamingFile,
  newName,
  setNewName,
  deletingFile,
  setDeletingFile,
  startRename,
  confirmRename,
  confirmDelete,
  renameMutation,
  deleteMutation,
  setRenamingFile,
}: {
  operationFiles: OperationFile[]
  renamingFile: string | null
  newName: string
  setNewName: (v: string) => void
  deletingFile: string | null
  setDeletingFile: (v: string | null) => void
  startRename: (f: string) => void
  confirmRename: () => void
  confirmDelete: (f: string) => void
  renameMutation: { isPending: boolean }
  deleteMutation: { isPending: boolean }
  setRenamingFile: (v: string | null) => void
}) {
  // Group files by year, sort years descending, months ascending within each year
  const grouped = operationFiles.reduce<Record<number, OperationFile[]>>((acc, file) => {
    const year = file.year ?? 0
    if (!acc[year]) acc[year] = []
    acc[year].push(file)
    return acc
  }, {})

  const sortedYears = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => b - a) // years descending

  // Sort files within each year by month ascending (Jan=1 → Dec=12)
  for (const year of sortedYears) {
    grouped[year].sort((a, b) => (a.month ?? 99) - (b.month ?? 99))
  }

  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())

  // Open all years by default when data loads
  useEffect(() => {
    if (sortedYears.length > 0 && expandedYears.size === 0) {
      setExpandedYears(new Set(sortedYears))
    }
  }, [sortedYears.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleYear = (year: number) => {
    setExpandedYears(prev => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  return (
    <div className="bg-surface rounded-2xl border border-border p-6">
      <h3 className="font-semibold text-text flex items-center gap-2 mb-4">
        <FolderOpen size={18} />
        Fichiers d'opérations
        <span className="text-xs text-text-muted font-normal ml-auto">
          {operationFiles.length} fichier{operationFiles.length > 1 ? 's' : ''}
        </span>
      </h3>

      {operationFiles.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-6">Aucun fichier d'opérations</p>
      ) : (
        <div className="space-y-3">
          {sortedYears.map(year => {
            const files = grouped[year]
            const isExpanded = expandedYears.has(year)
            const yearLabel = year === 0 ? 'Sans date' : String(year)

            return (
              <div key={year} className="rounded-xl border border-border overflow-hidden">
                {/* Year header — clickable accordion toggle */}
                <button
                  onClick={() => toggleYear(year)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-background hover:bg-surface-hover transition-colors"
                >
                  <ChevronDown
                    size={16}
                    className={cn(
                      'text-text-muted transition-transform duration-200',
                      isExpanded ? 'rotate-0' : '-rotate-90'
                    )}
                  />
                  <span className="text-sm font-semibold text-text">{yearLabel}</span>
                  <span className="text-xs text-text-muted ml-auto">
                    {files.length} relevé{files.length > 1 ? 's' : ''}
                  </span>
                </button>

                {/* Files list — collapsible */}
                {isExpanded && (
                  <div className="space-y-1 p-2">
                    {files.map(file => {
                      const title = file.month && file.year
                        ? `Relevé ${MOIS_FR[file.month - 1]} ${file.year}`
                        : file.filename.replace(/\.json$/, '').replace(/_/g, ' ')

                      return (
                        <div key={file.filename} className="bg-background rounded-lg p-3">
                          {renamingFile === file.filename ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') confirmRename()
                                  if (e.key === 'Escape') setRenamingFile(null)
                                }}
                                autoFocus
                                className="flex-1 bg-surface border border-primary/50 rounded-lg px-3 py-1.5 text-sm font-mono text-text focus:outline-none focus:border-primary"
                              />
                              <button
                                onClick={confirmRename}
                                disabled={renameMutation.isPending}
                                className="p-1.5 rounded-lg bg-success/20 text-success hover:bg-success/30 transition-colors"
                                title="Confirmer"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={() => setRenamingFile(null)}
                                className="p-1.5 rounded-lg bg-border/30 text-text-muted hover:bg-border/50 transition-colors"
                                title="Annuler"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : deletingFile === file.filename ? (
                            <div className="flex items-center justify-between">
                              <p className="text-sm text-danger">
                                Supprimer <span className="font-medium">{title}</span> et son PDF associé ?
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => confirmDelete(file.filename)}
                                  disabled={deleteMutation.isPending}
                                  className="px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-medium hover:bg-danger/80 transition-colors"
                                >
                                  {deleteMutation.isPending ? 'Suppression...' : 'Confirmer'}
                                </button>
                                <button
                                  onClick={() => setDeletingFile(null)}
                                  className="px-3 py-1.5 rounded-lg bg-border/30 text-text-muted text-xs hover:bg-border/50 transition-colors"
                                >
                                  Annuler
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-text truncate">{title}</p>
                                <p className="text-[10px] text-text-muted font-mono truncate">{file.filename}</p>
                              </div>
                              <div className="flex items-center gap-1.5 ml-3">
                                <span className="text-xs text-text-muted mr-2">{file.count} op.</span>
                                <button
                                  onClick={() => startRename(file.filename)}
                                  className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                                  title="Renommer"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => { setDeletingFile(file.filename); setRenamingFile(null) }}
                                  className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                                  title="Supprimer"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* File tree */}
      <FileTreeSection />
    </div>
  )
}


// ──── File Tree ────

interface TreeNode {
  name: string
  type: 'file' | 'dir'
  size: number
  size_human: string
  count?: number
  children?: TreeNode[]
}

function FileTreeSection() {
  const { data: tree, isLoading } = useQuery<TreeNode>({
    queryKey: ['file-tree'],
    queryFn: () => api.get('/settings/file-tree'),
  })

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (path: string) => {
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setExpanded(next)
  }

  const renderNode = (node: TreeNode, path: string, depth: number) => {
    const isDir = node.type === 'dir'
    const isOpen = expanded.has(path)
    return (
      <div key={path}>
        <div
          className={cn(
            'flex items-center gap-2 py-1 px-2 rounded hover:bg-surface-hover transition-colors text-xs',
            isDir ? 'cursor-pointer' : '',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => isDir && toggle(path)}
        >
          {isDir ? (
            isOpen ? <ChevronDown size={12} className="text-text-muted shrink-0" /> : <ChevronDown size={12} className="text-text-muted shrink-0 -rotate-90" />
          ) : (
            <FileText size={12} className="text-text-muted/40 shrink-0" />
          )}
          {isDir ? (
            <FolderOpen size={13} className="text-warning shrink-0" />
          ) : null}
          <span className={cn('truncate', isDir ? 'font-medium text-text' : 'text-text-muted')}>
            {node.name}
          </span>
          <span className="ml-auto text-[10px] text-text-muted/60 shrink-0 tabular-nums">
            {isDir && node.count != null ? `${node.count} fichiers \u00b7 ` : ''}{node.size_human}
          </span>
        </div>
        {isDir && isOpen && node.children?.map((child) =>
          renderNode(child, `${path}/${child.name}`, depth + 1)
        )}
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-2xl border border-border p-6">
      <h3 className="font-semibold text-text flex items-center gap-2 mb-4">
        <FolderOpen size={18} />
        Arborescence des fichiers
      </h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-text-muted text-sm py-4 justify-center">
          <Loader2 size={14} className="animate-spin" />
          Chargement...
        </div>
      ) : tree ? (
        <div className="max-h-[400px] overflow-y-auto border border-border rounded-lg bg-background p-2">
          {tree.children?.map((child) => renderNode(child, child.name, 0))}
          <div className="mt-2 pt-2 border-t border-border/50 px-2 text-[10px] text-text-muted">
            Total : {tree.count} fichiers \u00b7 {tree.size_human}
          </div>
        </div>
      ) : null}
    </div>
  )
}


// ──── System Tab ────

function SystemTab() {
  const { data: systemInfo, isLoading } = useQuery<SystemInfo>({
    queryKey: ['system-info'],
    queryFn: () => api.get('/settings/system-info'),
  })

  if (isLoading) return <LoadingSpinner text="Chargement..." />

  const info = systemInfo ? [
    { label: 'Application', value: `${systemInfo.app_name} v${systemInfo.app_version}`, icon: Info },
    { label: 'Python', value: systemInfo.python_version, icon: Server },
    { label: 'Plateforme', value: systemInfo.platform, icon: Monitor },
    { label: 'Architecture', value: systemInfo.machine, icon: Server },
    { label: 'Répertoire données', value: systemInfo.data_dir, icon: FolderOpen },
  ] : []

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h3 className="font-semibold text-text flex items-center gap-2 mb-4">
          <Server size={18} />
          Informations système
        </h3>

        <div className="space-y-3">
          {info.map((item, i) => (
            <div key={i} className="flex items-start gap-3 bg-background rounded-xl p-3.5">
              <item.icon size={16} className="text-primary mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-muted">{item.label}</p>
                <p className="text-sm text-text font-mono break-all">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Technologies */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h3 className="font-semibold text-text flex items-center gap-2 mb-4">
          <Database size={18} />
          Technologies
        </h3>

        <div className="grid grid-cols-2 gap-2">
          {[
            { name: 'React', version: '19', color: 'bg-info/10 text-info' },
            { name: 'FastAPI', version: 'Python', color: 'bg-success/10 text-success' },
            { name: 'TailwindCSS', version: '4', color: 'bg-primary/10 text-primary' },
            { name: 'TanStack Query', version: '5', color: 'bg-warning/10 text-warning' },
            { name: 'TypeScript', version: '5', color: 'bg-info/10 text-info' },
            { name: 'EasyOCR', version: '1.7+', color: 'bg-danger/10 text-danger' },
          ].map(tech => (
            <div key={tech.name} className="bg-background rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-text">{tech.name}</span>
              <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', tech.color)}>
                {tech.version}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


// ──── Email Tab ────

function EmailTab() {
  const { settings: localSettings, update, save, saving, saved, isLoading } = useSettingsForm()
  const testMutation = useTestEmailConnection()
  const [showPassword, setShowPassword] = useState(false)

  if (isLoading || !localSettings) return <LoadingSpinner text="Chargement..." />

  const handleTest = () => {
    testMutation.mutate(undefined, {
      onSuccess: (result) => {
        if (result.success) {
          toast.success(result.message)
        } else {
          toast.error(result.message)
        }
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-2xl border border-border p-6">
        <h2 className="text-lg font-semibold text-text flex items-center gap-2 mb-5">
          <Mail size={20} className="text-primary" />
          Email comptable
        </h2>

        <div className="space-y-4">
          {/* SMTP User */}
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Adresse Gmail expéditeur</label>
            <input
              type="email"
              value={localSettings.email_smtp_user ?? ''}
              onChange={e => update('email_smtp_user', e.target.value || null)}
              placeholder="votre.email@gmail.com"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
            />
          </div>

          {/* App Password */}
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Mot de passe d'application Google</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={localSettings.email_smtp_app_password ?? ''}
                onChange={e => update('email_smtp_app_password', e.target.value || null)}
                placeholder="xxxx xxxx xxxx xxxx"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-10 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary font-mono"
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              Google &rarr; Sécurité &rarr; Mots de passe des applications
            </p>
          </div>

          {/* Sender Name */}
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Nom expéditeur</label>
            <input
              type="text"
              value={localSettings.email_default_nom ?? ''}
              onChange={e => update('email_default_nom', e.target.value || null)}
              placeholder="Dr Dupont"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Destinataires */}
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Destinataires (comptable)</label>
            <EmailChipsInput
              emails={localSettings.email_comptable_destinataires ?? []}
              onChange={emails => update('email_comptable_destinataires', emails)}
              placeholder="comptable@cabinet.fr"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
          <button
            onClick={handleTest}
            disabled={!localSettings.email_smtp_user || !localSettings.email_smtp_app_password || testMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            {testMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} className="text-info" />
            )}
            Tester la connexion
          </button>

          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saved ? 'Sauvegardé' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ──── Toggle Switch ────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-border'
      )}
    >
      <div
        className={cn(
          'absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}
