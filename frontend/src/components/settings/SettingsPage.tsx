import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useSettings } from '@/hooks/useApi'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@/types'
import {
  Settings, Palette, FileText, HardDrive, Server, Save,
  Loader2, Check, Moon, Sun, Bell, BellOff, Eye,
  FolderOpen, Database, Paperclip, Brain, ScrollText,
  Archive, Clock, Info, Monitor,
} from 'lucide-react'

type Tab = 'general' | 'theme' | 'export' | 'storage' | 'system'

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
    { key: 'storage', label: 'Stockage', icon: HardDrive },
    { key: 'system', label: 'Système', icon: Server },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Paramètres"
        description="Configuration de l'application NeuronXcompta"
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-xl border border-border p-1 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm whitespace-nowrap transition-all',
              activeTab === tab.key
                ? 'bg-primary text-white shadow-md'
                : 'text-text-muted hover:text-text hover:bg-surface-hover'
            )}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'theme' && <ThemeTab />}
      {activeTab === 'export' && <ExportTab />}
      {activeTab === 'storage' && <StorageTab />}
      {activeTab === 'system' && <SystemTab />}
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
    <div className="space-y-6">
      <div className="bg-surface rounded-2xl border border-border p-6 space-y-6">
        <h3 className="font-semibold text-text flex items-center gap-2">
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
    { id: 'XLSX', label: 'Excel', desc: 'Multi-feuilles avec analyse', icon: FileText, color: 'text-info' },
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

function StorageTab() {
  const { data: diskSpace } = useQuery<DiskSpace>({
    queryKey: ['disk-space'],
    queryFn: () => api.get('/settings/disk-space'),
  })

  const { data: dataStats, isLoading } = useQuery<DataStats>({
    queryKey: ['data-stats'],
    queryFn: () => api.get('/settings/data-stats'),
  })

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
