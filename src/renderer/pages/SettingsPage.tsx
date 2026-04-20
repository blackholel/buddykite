/**
 * Settings Page - App configuration
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../stores/app.store'
import { api } from '../api'
import type {
  ApiValidationResult,
  KiteConfig,
  ThemeMode,
  ChatLayoutMode,
  McpServersConfig,
  ApiProfile
} from '../types'
import type { ClaudeCodeSlashRuntimeMode } from '../../shared/types/claude-code'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, ArrowLeft, Bot, CheckCircle2, ChevronDown, Download, ExternalLink, Eye, EyeOff, Info, Network, Palette, RefreshCw, ServerCog, Shield, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import { McpServerList } from '../components/settings/McpServerList'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../i18n'
import { ensureAiConfig } from '../../shared/types/ai-profile'
import {
  AI_PROFILE_TEMPLATES,
  getAiProfileTemplate,
  isValidAnthropicCompatEndpoint,
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
  normalizeModelCatalogForDefaultModelChange,
  normalizeProfileForSave
} from '../components/settings/aiProfileDomain'

function createProfileId(seed: string): string {
  const normalized = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'
  const rand = Math.random().toString(36).slice(2, 7)
  return `${normalized}-${Date.now().toString(36)}-${rand}`
}

function toUniqueProfileName(base: string, profiles: ApiProfile[]): string {
  const trimmed = base.trim() || 'Profile'
  if (!profiles.some(profile => profile.name === trimmed)) {
    return trimmed
  }

  let index = 2
  while (profiles.some(profile => profile.name === `${trimmed} ${index}`)) {
    index += 1
  }

  return `${trimmed} ${index}`
}

function selectFirstEnabledProfileId(profiles: ApiProfile[]): string {
  const enabledProfile = profiles.find(profile => profile.enabled !== false)
  return enabledProfile?.id || profiles[0]?.id || ''
}

export function resolveTemplateKeyFromProfile(profile: ApiProfile): string | null {
  if (profile.vendor === 'minimax' && profile.protocol === 'anthropic_compat') return 'minimax'
  if (profile.vendor === 'moonshot' && profile.protocol === 'anthropic_compat') return 'moonshot'
  if (profile.vendor === 'zhipu' && profile.protocol === 'anthropic_compat') return 'glm'
  if (profile.vendor === 'openai' && profile.protocol === 'openai_compat') return 'openai'
  if (profile.vendor === 'anthropic' && profile.protocol === 'anthropic_official') return 'anthropic_official'
  if (profile.protocol === 'anthropic_compat' && (profile.vendor === 'custom' || profile.vendor === 'anthropic')) {
    return 'anthropic_compat'
  }
  return null
}

export function createTemplatePlaceholderProfile(templateKey: string): ApiProfile {
  const template = AI_PROFILE_TEMPLATES.find(item => item.key === templateKey) || AI_PROFILE_TEMPLATES[0]
  return {
    id: `preset-${template.key}`,
    name: template.label,
    apiKey: '',
    enabled: false,
    presetKey: template.presetKey,
    vendor: template.vendor,
    protocol: template.protocol,
    apiUrl: template.apiUrl,
    defaultModel: template.defaultModel,
    modelCatalog: [...template.modelCatalog],
    docUrl: template.docUrl,
    openAICodexAuthMode: template.vendor === 'openai' && template.protocol === 'openai_compat'
      ? 'api_key'
      : undefined,
    openAICodexTenantId: template.vendor === 'openai' && template.protocol === 'openai_compat'
      ? OPENAI_CODEX_DEFAULT_TENANT_ID
      : undefined,
    openAICodexAccountId: undefined
  }
}

export function getFirstMissingTemplateKey(profiles: ApiProfile[]): string | null {
  const existingTemplateKeys = new Set(
    profiles
      .map(resolveTemplateKeyFromProfile)
      .filter((templateKey): templateKey is string => Boolean(templateKey))
  )
  const missingTemplate = AI_PROFILE_TEMPLATES.find(template => !existingTemplateKeys.has(template.key))
  return missingTemplate?.key || null
}

export function ensureTemplateProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const templateProfileByKey = new Map<string, ApiProfile>()

  for (const profile of profiles) {
    const templateKey = resolveTemplateKeyFromProfile(profile)
    if (!templateKey || templateProfileByKey.has(templateKey)) continue
    templateProfileByKey.set(templateKey, profile)
  }

  const mergedTemplateProfiles = AI_PROFILE_TEMPLATES.map(template =>
    templateProfileByKey.get(template.key) || createTemplatePlaceholderProfile(template.key)
  )

  const additionalProfiles = profiles.filter(profile => !resolveTemplateKeyFromProfile(profile))
  return [...mergedTemplateProfiles, ...additionalProfiles]
}

function getProfileMonogram(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '·'
  const matchedLatin = trimmed.match(/[A-Za-z]/)
  if (matchedLatin?.[0]) return matchedLatin[0].toUpperCase()
  return trimmed[0]
}

function isProfileUnconfigured(profile: ApiProfile): boolean {
  return !profile.apiKey.trim()
}

const THEME_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  { value: 'light', labelKey: 'Light' },
  { value: 'dark', labelKey: 'Dark' }
]

const CHAT_LAYOUT_WIDTH_MIN = 860
const CHAT_LAYOUT_WIDTH_MAX = 1600
const CHAT_LAYOUT_WIDTH_STEP = 20
const CHAT_LAYOUT_WIDTH_DEFAULT = 1100

function normalizeManualChatWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CHAT_LAYOUT_WIDTH_DEFAULT
  }
  return Math.max(CHAT_LAYOUT_WIDTH_MIN, Math.min(CHAT_LAYOUT_WIDTH_MAX, Math.round(value)))
}

type SettingsSectionId =
  | 'model'
  | 'appearance'
  | 'general'
  | 'permissions'
  | 'mcp'
  | 'network'
  | 'about'

type SettingsSectionGroup = 'required' | 'optional' | 'advanced'
type ModelSetupStep = 'provider' | 'account' | 'model'
type OpenAICodexAuthMode = 'api_key' | 'oauth_browser' | 'oauth_device'
type OpenAICodexDeviceAuthState = 'idle' | 'pending' | 'authorized' | 'expired' | 'error'

interface SettingsSectionDef {
  id: SettingsSectionId
  group: SettingsSectionGroup
  labelKey: string
  hintKey: string
  icon: LucideIcon
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'model',
    group: 'required',
    labelKey: 'Model',
    hintKey: 'Connect provider and model',
    icon: Bot
  },
  {
    id: 'appearance',
    group: 'optional',
    labelKey: 'Appearance',
    hintKey: 'Adjust theme and language',
    icon: Palette
  },
  {
    id: 'general',
    group: 'optional',
    labelKey: 'General',
    hintKey: 'Tune app behavior',
    icon: SlidersHorizontal
  },
  {
    id: 'permissions',
    group: 'advanced',
    labelKey: 'Permissions',
    hintKey: 'Review execution trust',
    icon: Shield
  },
  {
    id: 'mcp',
    group: 'advanced',
    labelKey: 'MCP',
    hintKey: 'Manage tool servers',
    icon: ServerCog
  },
  {
    id: 'network',
    group: 'optional',
    labelKey: 'Network',
    hintKey: 'Enable remote access',
    icon: Network
  },
  {
    id: 'about',
    group: 'advanced',
    labelKey: 'About',
    hintKey: 'Check version and updates',
    icon: Info
  }
]

const SETTINGS_SECTION_GROUPS: Array<{ id: SettingsSectionGroup; labelKey: string }> = [
  { id: 'required', labelKey: 'Must configure' },
  { id: 'optional', labelKey: 'Optional enhancements' },
  { id: 'advanced', labelKey: 'Advanced tools' }
]

const DEFAULT_EXPANDED_MODEL_STEPS: Record<ModelSetupStep, boolean> = {
  provider: true,
  account: true,
  model: false
}

const OPENAI_CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const OPENAI_CODEX_DEFAULT_TENANT_ID = 'default'

interface OpenAICodexBrowserSessionState {
  authUrl: string
  state: string
  redirectUri: string
}

interface OpenAICodexDeviceSessionState {
  deviceCode: string
  userCode: string
  verificationUri: string
  intervalSec: number
  expiresAt: number
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function asStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isOpenAICodexBackendUrl(apiUrl: string): boolean {
  return apiUrl.trim().toLowerCase().includes('chatgpt.com/backend-api')
}

function parseOpenAICodexCallbackInput(
  rawValue: string,
  fallbackState?: string
): { code: string; state: string } | null {
  const value = rawValue.trim()
  if (!value) return null

  try {
    const parsedUrl = new URL(value)
    const code = parsedUrl.searchParams.get('code')?.trim() || ''
    const state = parsedUrl.searchParams.get('state')?.trim() || fallbackState?.trim() || ''
    if (code && state) {
      return { code, state }
    }
  } catch {
    // Continue parsing as query string or raw code.
  }

  const queryString = value.startsWith('?') ? value.slice(1) : value
  const queryParams = new URLSearchParams(queryString)
  const queryCode = queryParams.get('code')?.trim() || ''
  const queryState = queryParams.get('state')?.trim() || fallbackState?.trim() || ''
  if (queryCode && queryState) {
    return { code: queryCode, state: queryState }
  }

  if (!value.includes('=')) {
    const fallback = fallbackState?.trim() || ''
    if (fallback) {
      return { code: value, state: fallback }
    }
  }

  return null
}

// Apple-style toggle component (extracted to top-level to avoid re-creation on every render)
function AppleToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`toggle-apple ${checked ? 'toggle-apple-on' : 'toggle-apple-off'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
    >
      <div className="toggle-apple-knob" />
    </button>
  )
}

// Remote access status type
interface RemoteAccessStatus {
  enabled: boolean
  server: {
    running: boolean
    port: number
    token: string | null
    localUrl: string | null
    lanUrl: string | null
  }
  tunnel: {
    status: 'stopped' | 'starting' | 'running' | 'error'
    url: string | null
    error: string | null
  }
  clients: number
}

interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
  currentVersion: string
  latestVersion?: string | null
  checkTime?: string | null
  message?: string
  downloadSource?: 'github' | 'baidu' | null
  downloadUrl?: string | null
  baiduExtractCode?: string | null
}

interface OpenAICodexAuthPanelProps {
  t: (key: string, options?: Record<string, unknown>) => string
  isOpenAIProfile: boolean
  openAICodexAuthMode: OpenAICodexAuthMode
  isOpenAICodexAuthRunning: boolean
  openAICodexTenantId: string
  openAICodexAccountId: string
  openAICodexBrowserSession: OpenAICodexBrowserSessionState | null
  openAICodexBrowserCallbackInput: string
  openAICodexDeviceSession: OpenAICodexDeviceSessionState | null
  openAICodexDeviceState: OpenAICodexDeviceAuthState
  openAICodexStatusMessage: string | null
  onAuthModeChange: (mode: OpenAICodexAuthMode) => void
  onTenantIdChange: (value: string) => void
  onAccountIdChange: (value: string) => void
  onStartBrowserAuth: () => void
  onFinishBrowserAuth: () => void
  onStartDeviceAuth: () => void
  onPollDeviceAuth: () => void
  onBrowserCallbackInputChange: (value: string) => void
  onCopyToClipboard: (value: string) => void
  onOpenExternal: (url: string) => void
}

const OpenAICodexAuthPanel = memo(function OpenAICodexAuthPanel({
  t,
  isOpenAIProfile,
  openAICodexAuthMode,
  isOpenAICodexAuthRunning,
  openAICodexTenantId,
  openAICodexAccountId,
  openAICodexBrowserSession,
  openAICodexBrowserCallbackInput,
  openAICodexDeviceSession,
  openAICodexDeviceState,
  openAICodexStatusMessage,
  onAuthModeChange,
  onTenantIdChange,
  onAccountIdChange,
  onStartBrowserAuth,
  onFinishBrowserAuth,
  onStartDeviceAuth,
  onPollDeviceAuth,
  onBrowserCallbackInputChange,
  onCopyToClipboard,
  onOpenExternal
}: OpenAICodexAuthPanelProps) {
  if (!isOpenAIProfile) return null

  return (
    <div className="space-y-3 rounded-xl border border-border/75 bg-secondary/20 p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Connection method')}</label>
        <p className="text-xs text-muted-foreground">
          {t('Use API Key, or authorize your ChatGPT account for openai-codex.')}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onAuthModeChange('api_key')}
          className={`settings-choice-btn ${openAICodexAuthMode === 'api_key' ? 'settings-choice-btn-active' : ''}`}
        >
          {t('API Key')}
        </button>
        <button
          type="button"
          onClick={() => onAuthModeChange('oauth_browser')}
          className={`settings-choice-btn ${openAICodexAuthMode === 'oauth_browser' ? 'settings-choice-btn-active' : ''}`}
        >
          {t('ChatGPT (browser)')}
        </button>
        <button
          type="button"
          onClick={() => onAuthModeChange('oauth_device')}
          className={`settings-choice-btn ${openAICodexAuthMode === 'oauth_device' ? 'settings-choice-btn-active' : ''}`}
        >
          {t('ChatGPT (device code)')}
        </button>
      </div>

      {openAICodexAuthMode !== 'api_key' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Tenant ID')}</label>
            <input
              type="text"
              value={openAICodexTenantId}
              onChange={(event) => onTenantIdChange(event.target.value)}
              className="w-full input-apple px-4 py-2.5 text-sm"
              placeholder={OPENAI_CODEX_DEFAULT_TENANT_ID}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('ChatGPT Account ID (optional)')}</label>
            <input
              type="text"
              value={openAICodexAccountId}
              onChange={(event) => onAccountIdChange(event.target.value)}
              className="w-full input-apple px-4 py-2.5 text-sm"
              placeholder={t('account id')}
            />
          </div>
        </div>
      )}

      {openAICodexAuthMode === 'oauth_browser' && (
        <div className="space-y-3 rounded-lg border border-border/70 bg-background/70 p-3">
          <button
            type="button"
            onClick={onStartBrowserAuth}
            className="settings-action-button settings-action-button-secondary"
            disabled={isOpenAICodexAuthRunning}
          >
            <span>{isOpenAICodexAuthRunning ? t('Starting...') : t('Open browser authorization')}</span>
          </button>
          {openAICodexBrowserSession && (
            <>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t('Authorization link is ready. If browser did not open, use the actions below.')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onCopyToClipboard(openAICodexBrowserSession.authUrl)}
                    className="settings-action-button settings-action-button-secondary"
                  >
                    <span>{t('Copy authorization URL')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenExternal(openAICodexBrowserSession.authUrl)}
                    className="settings-action-button settings-action-button-secondary"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>{t('Open again')}</span>
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('If your default browser shows TLS errors, copy this URL and open it manually in another browser.')}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Callback URL or code')}</label>
                <input
                  type="text"
                  value={openAICodexBrowserCallbackInput}
                  onChange={(event) => onBrowserCallbackInputChange(event.target.value)}
                  className="w-full input-apple px-4 py-2.5 text-sm"
                  placeholder={t('Paste callback URL, query string, or code')}
                />
              </div>
              <button
                type="button"
                onClick={onFinishBrowserAuth}
                className="settings-action-button settings-action-button-primary"
                disabled={isOpenAICodexAuthRunning}
              >
                <span>{isOpenAICodexAuthRunning ? t('Completing...') : t('Complete browser authorization')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {openAICodexAuthMode === 'oauth_device' && (
        <div className="space-y-3 rounded-lg border border-border/70 bg-background/70 p-3">
          <button
            type="button"
            onClick={onStartDeviceAuth}
            className="settings-action-button settings-action-button-secondary"
            disabled={isOpenAICodexAuthRunning}
          >
            <span>{isOpenAICodexAuthRunning ? t('Starting...') : t('Start device authorization')}</span>
          </button>
          {openAICodexDeviceSession && (
            <>
              <div className="rounded-md bg-secondary/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">{t('Verification code')}</p>
                <p className="mt-1 text-base font-semibold tracking-[0.18em] text-foreground">
                  {openAICodexDeviceSession.userCode}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenExternal(openAICodexDeviceSession.verificationUri)}
                  className="settings-action-button settings-action-button-secondary"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span>{t('Open verification page')}</span>
                </button>
                <button
                  type="button"
                  onClick={onPollDeviceAuth}
                  className="settings-action-button settings-action-button-primary"
                  disabled={isOpenAICodexAuthRunning || openAICodexDeviceState === 'expired' || openAICodexDeviceState === 'authorized'}
                >
                  <span>{isOpenAICodexAuthRunning ? t('Checking...') : t('Check authorization')}</span>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {openAICodexDeviceState === 'authorized'
                  ? t('Device authorization completed.')
                  : openAICodexDeviceState === 'expired'
                    ? t('Device authorization expired, please start again.')
                    : `If pending, wait about ${openAICodexDeviceSession.intervalSec} seconds before checking again.`}
              </p>
            </>
          )}
        </div>
      )}

      {openAICodexStatusMessage && (
        <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground">
          {openAICodexStatusMessage}
        </div>
      )}

    </div>
  )
})

export function SettingsPage() {
  const { t } = useTranslation()
  const { config, setConfig, goBack, setStarterExperienceHiddenForSession } = useAppStore()

  const initialAiConfig = ensureAiConfig(config?.ai, config?.api)
  const [profiles, setProfiles] = useState<ApiProfile[]>(ensureTemplateProfiles(initialAiConfig.profiles))
  const [defaultProfileId, setDefaultProfileId] = useState(initialAiConfig.defaultProfileId)
  const [selectedProfileId, setSelectedProfileId] = useState(initialAiConfig.defaultProfileId)
  const [theme, setTheme] = useState<ThemeMode>(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
  const [chatLayoutMode, setChatLayoutMode] = useState<ChatLayoutMode>(
    config?.appearance?.chatLayout?.mode === 'manual' ? 'manual' : 'auto'
  )
  const [manualChatWidthPx, setManualChatWidthPx] = useState<number>(
    normalizeManualChatWidth(config?.appearance?.chatLayout?.manualWidthPx)
  )
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('model')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelInput, setModelInput] = useState('')
  const [showAdvancedConnectionFields, setShowAdvancedConnectionFields] = useState(false)
  const [showAdvancedModelFields, setShowAdvancedModelFields] = useState(false)
  const [expandedModelSteps, setExpandedModelSteps] = useState<Record<ModelSetupStep, boolean>>(DEFAULT_EXPANDED_MODEL_STEPS)

  // Connection status
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ApiValidationResult | null>(null)

  // Remote access state
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null)
  const [isEnablingRemote, setIsEnablingRemote] = useState(false)
  const [isEnablingTunnel, setIsEnablingTunnel] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // System settings state
  const [autoLaunch, setAutoLaunch] = useState(config?.system?.autoLaunch || false)
  const [minimizeToTray, setMinimizeToTray] = useState(config?.system?.minimizeToTray || false)
  const [isSavingSlashRuntimeMode, setIsSavingSlashRuntimeMode] = useState(false)

  // Updater state (About section)
  const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)

  // OpenAI Codex OAuth state
  const [openAICodexAuthMode, setOpenAICodexAuthMode] = useState<OpenAICodexAuthMode>('api_key')
  const [openAICodexTenantId, setOpenAICodexTenantId] = useState(OPENAI_CODEX_DEFAULT_TENANT_ID)
  const [openAICodexAccountId, setOpenAICodexAccountId] = useState('')
  const [openAICodexBrowserSession, setOpenAICodexBrowserSession] = useState<OpenAICodexBrowserSessionState | null>(null)
  const [openAICodexBrowserCallbackInput, setOpenAICodexBrowserCallbackInput] = useState('')
  const [openAICodexDeviceSession, setOpenAICodexDeviceSession] = useState<OpenAICodexDeviceSessionState | null>(null)
  const [openAICodexDeviceState, setOpenAICodexDeviceState] = useState<OpenAICodexDeviceAuthState>('idle')
  const [openAICodexStatusMessage, setOpenAICodexStatusMessage] = useState<string | null>(null)
  const [isOpenAICodexAuthRunning, setIsOpenAICodexAuthRunning] = useState(false)

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  )
  const firstMissingTemplateKey = useMemo(() => getFirstMissingTemplateKey(profiles), [profiles])
  const canAddProfileFromTemplate = Boolean(firstMissingTemplateKey)
  const selectedCatalog = useMemo(
    () => (selectedProfile
      ? normalizeModelCatalog(selectedProfile.defaultModel, selectedProfile.modelCatalog)
      : []),
    [selectedProfile]
  )
  const isOpenAIProfile = useMemo(
    () => Boolean(
      selectedProfile &&
      selectedProfile.vendor === 'openai' &&
      selectedProfile.protocol === 'openai_compat'
    ),
    [selectedProfile]
  )
  const isOpenAICodexMode = useMemo(
    () => isOpenAIProfile && openAICodexAuthMode !== 'api_key',
    [isOpenAIProfile, openAICodexAuthMode]
  )
  const selectedProfileUrlError = (() => {
    if (!selectedProfile) return null
    const apiUrl = selectedProfile.apiUrl.trim()
    if (!apiUrl) return null
    if (selectedProfile.protocol === 'openai_compat' && !isValidOpenAICompatEndpoint(apiUrl)) {
      return t('URL must end with /chat/completions or /responses')
    }
    if (selectedProfile.protocol === 'anthropic_compat' && !isValidAnthropicCompatEndpoint(apiUrl)) {
      return t('Anthropic compatible URL should not end with /chat/completions or /responses')
    }
    return null
  })()
  const selectedProfileUrlInvalid = Boolean(selectedProfileUrlError)
  const selectedTemplate = selectedProfile ? getAiProfileTemplate(selectedProfile) : undefined

  // Load remote access status
  useEffect(() => {
    loadRemoteStatus()

    // Listen for status changes
    const unsubscribe = api.onRemoteStatusChange((data) => {
      setRemoteStatus(data as RemoteAccessStatus)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const nextAiConfig = ensureAiConfig(config?.ai, config?.api)
    setProfiles(ensureTemplateProfiles(nextAiConfig.profiles))
    setDefaultProfileId(nextAiConfig.defaultProfileId)
    setSelectedProfileId((prev) => {
      if (nextAiConfig.profiles.some(profile => profile.id === prev)) {
        return prev
      }
      return nextAiConfig.defaultProfileId
    })
  }, [config?.ai, config?.api])

  useEffect(() => {
    setShowApiKey(false)
    setModelInput('')
    setShowAdvancedConnectionFields(false)
    setShowAdvancedModelFields(false)
    setExpandedModelSteps(DEFAULT_EXPANDED_MODEL_STEPS)
    setOpenAICodexBrowserSession(null)
    setOpenAICodexBrowserCallbackInput('')
    setOpenAICodexDeviceSession(null)
    setOpenAICodexDeviceState('idle')
    setOpenAICodexStatusMessage(null)
    setIsOpenAICodexAuthRunning(false)
    const profileMode = selectedProfile?.openAICodexAuthMode
    const fallbackMode = (
      selectedProfile?.vendor === 'openai' &&
      selectedProfile.protocol === 'openai_compat' &&
      isOpenAICodexBackendUrl(selectedProfile.apiUrl)
    )
      ? 'oauth_browser'
      : 'api_key'
    const nextMode = profileMode || fallbackMode
    setOpenAICodexAuthMode(nextMode)
    setOpenAICodexTenantId(selectedProfile?.openAICodexTenantId || OPENAI_CODEX_DEFAULT_TENANT_ID)
    setOpenAICodexAccountId(selectedProfile?.openAICodexAccountId || '')
  }, [selectedProfileId])

  useEffect(() => {
    setTheme(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
    setChatLayoutMode(config?.appearance?.chatLayout?.mode === 'manual' ? 'manual' : 'auto')
    setManualChatWidthPx(normalizeManualChatWidth(config?.appearance?.chatLayout?.manualWidthPx))
  }, [config?.appearance?.chatLayout?.manualWidthPx, config?.appearance?.chatLayout?.mode, config?.appearance?.theme])

  // Load system settings
  useEffect(() => {
    loadSystemSettings()
  }, [])

  useEffect(() => {
    if (api.isRemoteMode()) return

    void loadUpdaterState()
    const unsubscribe = api.onUpdaterStatus((data) => {
      const nextState = data as UpdaterState
      setUpdaterState(nextState)
      setIsCheckingUpdate(nextState.status === 'checking')
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const loadSystemSettings = async () => {
    try {
      const [autoLaunchRes, minimizeRes] = await Promise.all([
        api.getAutoLaunch(),
        api.getMinimizeToTray()
      ])
      if (autoLaunchRes.success) {
        setAutoLaunch(autoLaunchRes.data as boolean)
      }
      if (minimizeRes.success) {
        setMinimizeToTray(minimizeRes.data as boolean)
      }
    } catch (error) {
      console.error('[Settings] Failed to load system settings:', error)
    }
  }

  const loadUpdaterState = async () => {
    try {
      const response = await api.getUpdaterState()
      if (response.success && response.data) {
        const nextState = response.data as UpdaterState
        setUpdaterState(nextState)
        setIsCheckingUpdate(nextState.status === 'checking')
      }
    } catch (error) {
      console.error('[Settings] Failed to load updater state:', error)
    }
  }

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true)
    try {
      await api.checkForUpdates()
    } catch (error) {
      console.error('[Settings] Failed to check updates:', error)
      setIsCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = async () => {
    const version = updaterState?.latestVersion || updaterState?.currentVersion
    if (!version) return
    const targetUrl = updaterState?.downloadUrl || `https://github.com/blackholel/buddykite/releases/tag/v${version}`
    await api.openExternal(targetUrl)
  }

  // Load QR code when remote is enabled
  useEffect(() => {
    if (remoteStatus?.enabled) {
      loadQRCode()
    } else {
      setQrCode(null)
    }
  }, [remoteStatus?.enabled, remoteStatus?.tunnel.url])

  const loadRemoteStatus = async () => {
    console.log('[Settings] loadRemoteStatus called')
    try {
      const response = await api.getRemoteStatus()
      console.log('[Settings] getRemoteStatus response:', response)
      if (response.success && response.data) {
        setRemoteStatus(response.data as RemoteAccessStatus)
      }
    } catch (error) {
      console.error('[Settings] loadRemoteStatus error:', error)
    }
  }

  const loadQRCode = async () => {
    const response = await api.getRemoteQRCode(true) // Include token
    if (response.success && response.data) {
      setQrCode((response.data as any).qrCode)
    }
  }

  const handleToggleRemote = async () => {
    console.log('[Settings] handleToggleRemote called, current status:', remoteStatus?.enabled)

    if (remoteStatus?.enabled) {
      // Disable
      console.log('[Settings] Disabling remote access...')
      const response = await api.disableRemoteAccess()
      console.log('[Settings] Disable response:', response)
      setRemoteStatus(null)
      setQrCode(null)
    } else {
      // Enable
      console.log('[Settings] Enabling remote access...')
      setIsEnablingRemote(true)
      try {
        const response = await api.enableRemoteAccess()
        console.log('[Settings] Enable response:', response)
        if (response.success && response.data) {
          setRemoteStatus(response.data as RemoteAccessStatus)
        } else {
          console.error('[Settings] Enable failed:', response.error)
        }
      } catch (error) {
        console.error('[Settings] Enable error:', error)
      } finally {
        setIsEnablingRemote(false)
      }
    }
  }

  const handleToggleTunnel = async () => {
    if (remoteStatus?.tunnel.status === 'running') {
      // Disable tunnel
      await api.disableTunnel()
    } else {
      // Enable tunnel
      setIsEnablingTunnel(true)
      try {
        await api.enableTunnel()
      } finally {
        setIsEnablingTunnel(false)
      }
    }
    loadRemoteStatus()
  }

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  const handleOpenExternal = useCallback((url: string) => {
    void api.openExternal(url)
  }, [])

  const handleThemeChange = async (nextTheme: ThemeMode) => {
    setTheme(nextTheme)

    try {
      localStorage.setItem('kite-theme', nextTheme)
    } catch {
      // ignore
    }

    try {
      await api.setConfig({ appearance: { theme: nextTheme } })
      if (config) {
        setConfig({
          ...config,
          appearance: { ...config.appearance, theme: nextTheme }
        } as KiteConfig)
      }
    } catch (error) {
      console.error('[Settings] Failed to save theme:', error)
      setTheme(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
    }
  }

  const handleLanguageChange = (locale: LocaleCode) => {
    setLanguage(locale)
  }

  const applyChatLayoutConfigToStore = (nextMode: ChatLayoutMode, nextManualWidthPx: number) => {
    if (!config) return
    setConfig({
      ...config,
      appearance: {
        ...config.appearance,
        chatLayout: {
          mode: nextMode,
          manualWidthPx: nextManualWidthPx
        }
      }
    } as KiteConfig)
  }

  const persistChatLayoutConfig = async (nextMode: ChatLayoutMode, nextManualWidthPx: number) => {
    const normalizedWidth = normalizeManualChatWidth(nextManualWidthPx)
    try {
      await api.setConfig({
        appearance: {
          chatLayout: {
            mode: nextMode,
            manualWidthPx: normalizedWidth
          }
        }
      })
      applyChatLayoutConfigToStore(nextMode, normalizedWidth)
    } catch (error) {
      console.error('[Settings] Failed to save chat layout:', error)
      setChatLayoutMode(config?.appearance?.chatLayout?.mode === 'manual' ? 'manual' : 'auto')
      setManualChatWidthPx(normalizeManualChatWidth(config?.appearance?.chatLayout?.manualWidthPx))
    }
  }

  const handleChatLayoutModeChange = async (autoEnabled: boolean) => {
    const nextMode: ChatLayoutMode = autoEnabled ? 'auto' : 'manual'
    setChatLayoutMode(nextMode)
    await persistChatLayoutConfig(nextMode, manualChatWidthPx)
  }

  const handleManualChatWidthDraftChange = (nextValue: number) => {
    setManualChatWidthPx(normalizeManualChatWidth(nextValue))
  }

  const handleManualChatWidthCommit = async (nextValue: number) => {
    const normalizedWidth = normalizeManualChatWidth(nextValue)
    setManualChatWidthPx(normalizedWidth)
    await persistChatLayoutConfig('manual', normalizedWidth)
  }

  // Handle auto launch change
  const handleAutoLaunchChange = async (enabled: boolean) => {
    setAutoLaunch(enabled)
    try {
      await api.setAutoLaunch(enabled)
    } catch (error) {
      console.error('[Settings] Failed to set auto launch:', error)
      setAutoLaunch(!enabled) // Revert on error
    }
  }

  // Handle minimize to tray change
  const handleMinimizeToTrayChange = async (enabled: boolean) => {
    setMinimizeToTray(enabled)
    try {
      await api.setMinimizeToTray(enabled)
    } catch (error) {
      console.error('[Settings] Failed to set minimize to tray:', error)
      setMinimizeToTray(!enabled) // Revert on error
    }
  }

  const handleStarterExperienceVisibilityChange = async (visible: boolean) => {
    const hidden = !visible
    try {
      await api.setConfig({
        onboarding: {
          homeGuideHidden: hidden,
          starterExperienceHidden: hidden
        }
      })
      if (config) {
        setConfig({
          ...config,
          onboarding: {
            ...config.onboarding,
            homeGuideHidden: hidden,
            starterExperienceHidden: hidden
          }
        } as KiteConfig)
      }
      if (visible) {
        setStarterExperienceHiddenForSession(false)
      }
    } catch (error) {
      console.error('[Settings] Failed to set starter experience visibility:', error)
    }
  }

  const slashRuntimeMode: ClaudeCodeSlashRuntimeMode =
    config?.claudeCode?.slashRuntimeMode === 'legacy-inject' ? 'legacy-inject' : 'native'

  const handleSlashRuntimeModeChange = async (nextMode: ClaudeCodeSlashRuntimeMode) => {
    if (nextMode === slashRuntimeMode) return
    setIsSavingSlashRuntimeMode(true)
    try {
      const nextClaudeCode = {
        ...(config?.claudeCode || {}),
        slashRuntimeMode: nextMode
      }
      await api.setConfig({
        claudeCode: nextClaudeCode
      })
      if (config) {
        setConfig({
          ...config,
          claudeCode: nextClaudeCode
        } as KiteConfig)
      }
    } catch (error) {
      console.error('[Settings] Failed to save slash runtime mode:', error)
    } finally {
      setIsSavingSlashRuntimeMode(false)
    }
  }

  // Handle MCP servers save
  const handleMcpServersSave = async (servers: McpServersConfig) => {
    await api.setConfig({ mcpServers: servers })
    setConfig({ ...config, mcpServers: servers } as KiteConfig)
  }

  const updateSelectedProfile = useCallback((updates: Partial<ApiProfile>) => {
    if (!selectedProfileId) return

    setProfiles(prevProfiles =>
      prevProfiles.map(profile =>
        profile.id === selectedProfileId
          ? {
              ...profile,
              ...updates
            }
          : profile
      )
    )
  }, [selectedProfileId])

  const handleSelectedProfileEnabledChange = (enabled: boolean) => {
    if (!selectedProfile) return

    const nextProfiles = profiles.map(profile =>
      profile.id === selectedProfile.id
        ? {
            ...profile,
            enabled
          }
        : profile
    )
    setProfiles(nextProfiles)

    if (!enabled && selectedProfile.id === defaultProfileId) {
      setDefaultProfileId(selectFirstEnabledProfileId(nextProfiles))
    }
  }

  const persistAiProfiles = async (
    nextProfilesInput: ApiProfile[],
    preferredDefaultProfileId: string
  ): Promise<{
    normalizedProfiles: ApiProfile[]
    normalizedDefaultProfileId: string
  }> => {
    const normalizedProfiles = nextProfilesInput.map(normalizeProfileForSave)
    const selectedDefault = normalizedProfiles.find(profile => profile.id === preferredDefaultProfileId)
    const normalizedDefaultProfileId = selectedDefault && selectedDefault.enabled !== false
      ? selectedDefault.id
      : selectFirstEnabledProfileId(normalizedProfiles)
    const aiConfig = {
      profiles: normalizedProfiles,
      defaultProfileId: normalizedDefaultProfileId
    }

    await api.setConfig({ ai: aiConfig, isFirstLaunch: false })
    setConfig({
      ...config,
      ai: aiConfig,
      isFirstLaunch: false
    } as KiteConfig)

    return {
      normalizedProfiles,
      normalizedDefaultProfileId
    }
  }

  const applyOpenAICodexAuthorizedCredential = async (payload: unknown): Promise<boolean> => {
    if (!selectedProfileId) {
      setOpenAICodexStatusMessage(t('Please select an OpenAI account profile first.'))
      return false
    }

    const data = asObjectRecord(payload)
    const token = asObjectRecord(data?.token)
    const credential = asObjectRecord(data?.credential)

    const accessToken =
      asStringValue(token?.accessToken) ||
      asStringValue(credential?.accessToken)
    if (!accessToken) {
      setOpenAICodexStatusMessage(t('Authorization succeeded but token is missing, please retry.'))
      return false
    }

    const accountId =
      asStringValue(token?.accountId) ||
      asStringValue(credential?.accountId)
    if (!accountId) {
      setOpenAICodexStatusMessage(t('Authorization succeeded but ChatGPT Account ID is missing. Please reconnect.'))
      return false
    }
    const tenantId = openAICodexTenantId.trim() || OPENAI_CODEX_DEFAULT_TENANT_ID

    let profileMatched = false
    const nextProfiles = profiles.map(profile => {
      if (profile.id !== selectedProfileId) return profile
      profileMatched = true
      const nextDefaultModel = profile.defaultModel.trim() || 'gpt-5-codex'
      return {
        ...profile,
        apiKey: accessToken,
        apiUrl: OPENAI_CODEX_RESPONSES_ENDPOINT,
        openAICodexAuthMode,
        openAICodexTenantId: tenantId,
        openAICodexAccountId: accountId,
        defaultModel: nextDefaultModel,
        modelCatalog: normalizeModelCatalog(nextDefaultModel, profile.modelCatalog)
      }
    })
    if (!profileMatched) {
      setOpenAICodexStatusMessage(t('Selected profile not found. Please re-open settings and retry.'))
      return false
    }

    setProfiles(nextProfiles)
    setDefaultProfileId(selectedProfileId)
    if (accountId) {
      setOpenAICodexAccountId(accountId)
    }
    setOpenAICodexTenantId(tenantId)

    try {
      const persisted = await persistAiProfiles(nextProfiles, selectedProfileId)
      const currentProfile = persisted.normalizedProfiles.find(profile => profile.id === selectedProfileId)
      const currentModel = currentProfile?.defaultModel || selectedProfile?.defaultModel || 'gpt-5-codex'
      const successMessage = t('ChatGPT authorization succeeded and has been saved as default account.')
      setOpenAICodexStatusMessage(successMessage)
      setValidationResult({
        valid: true,
        message: successMessage,
        connectionSummary: successMessage,
        availableModels: currentProfile?.modelCatalog?.length ? currentProfile.modelCatalog : ['gpt-5-codex'],
        manualModelInputRequired: false,
        resolvedModel: currentModel
      })
      openModelStep('model')
      return true
    } catch (error) {
      setOpenAICodexStatusMessage(t('Authorization succeeded, but saving settings failed. Click Save and finish to retry.'))
      setValidationResult({
        valid: false,
        message: t('Authorization succeeded, but saving settings failed. Click Save and finish to retry.'),
        availableModels: [],
        manualModelInputRequired: false
      })
      return false
    }
  }

  const handleOpenAICodexAuthModeChange = useCallback((nextMode: OpenAICodexAuthMode) => {
    if (!selectedProfile || !isOpenAIProfile) return

    setOpenAICodexAuthMode(nextMode)
    updateSelectedProfile({
      openAICodexAuthMode: nextMode
    })
    setOpenAICodexBrowserSession(null)
    setOpenAICodexBrowserCallbackInput('')
    setOpenAICodexDeviceSession(null)
    setOpenAICodexDeviceState('idle')
    setOpenAICodexStatusMessage(null)
    setValidationResult(null)

    if (nextMode === 'api_key') {
      if (isOpenAICodexBackendUrl(selectedProfile.apiUrl)) {
        const openAITemplate = AI_PROFILE_TEMPLATES.find(template => template.presetKey === 'openai')
        if (openAITemplate) {
          updateSelectedProfile({
            apiUrl: openAITemplate.apiUrl
          })
        }
      }
      return
    }

    if (!isOpenAICodexBackendUrl(selectedProfile.apiUrl)) {
      updateSelectedProfile({ apiUrl: OPENAI_CODEX_RESPONSES_ENDPOINT })
    }
  }, [isOpenAIProfile, selectedProfile, t, updateSelectedProfile])

  const handleOpenAICodexTenantIdChange = useCallback((nextValue: string) => {
    setOpenAICodexTenantId(nextValue)
    updateSelectedProfile({ openAICodexTenantId: nextValue })
  }, [updateSelectedProfile])

  const handleOpenAICodexAccountIdChange = useCallback((nextValue: string) => {
    setOpenAICodexAccountId(nextValue)
    updateSelectedProfile({ openAICodexAccountId: nextValue })
  }, [updateSelectedProfile])

  const handleStartOpenAICodexBrowserAuth = useCallback(async () => {
    if (!selectedProfile || !isOpenAIProfile) return
    setIsOpenAICodexAuthRunning(true)
    setOpenAICodexStatusMessage(null)

    try {
      const response = await api.startOpenAICodexBrowserAuth({
        tenantId: openAICodexTenantId.trim() || OPENAI_CODEX_DEFAULT_TENANT_ID,
        ...(openAICodexAccountId.trim() ? { accountId: openAICodexAccountId.trim() } : {})
      })
      if (!response.success) {
        setOpenAICodexStatusMessage(response.error || t('Failed to start browser authorization'))
        return
      }

      const data = asObjectRecord(response.data)
      const authUrl = asStringValue(data?.authUrl)
      const state = asStringValue(data?.state)
      const redirectUri = asStringValue(data?.redirectUri)
      if (!authUrl || !state) {
        setOpenAICodexStatusMessage(t('Invalid authorization payload, please retry.'))
        return
      }

      setOpenAICodexBrowserSession({ authUrl, state, redirectUri })
      await api.openExternal(authUrl)
      setOpenAICodexStatusMessage(t('Browser authorization page opened. Complete sign-in, then paste callback URL below.'))
    } catch (error) {
      setOpenAICodexStatusMessage(t('Failed to start browser authorization'))
    } finally {
      setIsOpenAICodexAuthRunning(false)
    }
  }, [isOpenAIProfile, openAICodexAccountId, openAICodexTenantId, selectedProfile, t])

  const handleFinishOpenAICodexBrowserAuth = useCallback(async () => {
    if (!openAICodexBrowserSession) {
      setOpenAICodexStatusMessage(t('Start browser authorization first.'))
      return
    }

    const callbackInput = openAICodexBrowserCallbackInput.trim()
    const parsed = callbackInput
      ? parseOpenAICodexCallbackInput(callbackInput, openAICodexBrowserSession.state)
      : { state: openAICodexBrowserSession.state, code: '' }
    if (!parsed) {
      setOpenAICodexStatusMessage(t('Paste callback URL (or code), or keep browser open and click complete again.'))
      return
    }

    setIsOpenAICodexAuthRunning(true)
    try {
      const response = await api.finishOpenAICodexBrowserAuth({
        state: parsed.state,
        code: parsed.code
      })
      if (!response.success) {
        setOpenAICodexStatusMessage(response.error || t('Browser authorization failed'))
        return
      }

      const applied = await applyOpenAICodexAuthorizedCredential(response.data)
      if (applied) {
        setOpenAICodexBrowserSession(null)
        setOpenAICodexBrowserCallbackInput('')
      }
    } catch (error) {
      setOpenAICodexStatusMessage(t('Browser authorization failed'))
    } finally {
      setIsOpenAICodexAuthRunning(false)
    }
  }, [applyOpenAICodexAuthorizedCredential, openAICodexBrowserCallbackInput, openAICodexBrowserSession, t])

  const handleStartOpenAICodexDeviceAuth = useCallback(async () => {
    if (!selectedProfile || !isOpenAIProfile) return

    setIsOpenAICodexAuthRunning(true)
    setOpenAICodexStatusMessage(null)
    setOpenAICodexDeviceState('idle')
    try {
      const response = await api.startOpenAICodexDeviceAuth({
        tenantId: openAICodexTenantId.trim() || OPENAI_CODEX_DEFAULT_TENANT_ID,
        ...(openAICodexAccountId.trim() ? { accountId: openAICodexAccountId.trim() } : {})
      })
      if (!response.success) {
        setOpenAICodexStatusMessage(response.error || t('Failed to start device authorization'))
        return
      }

      const data = asObjectRecord(response.data)
      const deviceCode = asStringValue(data?.deviceCode)
      const userCode = asStringValue(data?.userCode)
      const verificationUri = asStringValue(data?.verificationUri)
      const intervalSec = Number(data?.intervalSec || 5)
      const expiresIn = Number(data?.expiresIn || 1800)
      if (!deviceCode || !userCode || !verificationUri) {
        setOpenAICodexStatusMessage(t('Invalid device authorization payload, please retry.'))
        return
      }

      setOpenAICodexDeviceSession({
        deviceCode,
        userCode,
        verificationUri,
        intervalSec: Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 5,
        expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 1800) * 1000
      })
      setOpenAICodexDeviceState('pending')
      await api.openExternal(verificationUri)
      setOpenAICodexStatusMessage(t('Device authorization started. Enter the code on the opened page, then click Check authorization.'))
    } catch (error) {
      setOpenAICodexStatusMessage(t('Failed to start device authorization'))
    } finally {
      setIsOpenAICodexAuthRunning(false)
    }
  }, [isOpenAIProfile, openAICodexAccountId, openAICodexTenantId, selectedProfile, t])

  const handlePollOpenAICodexDeviceAuth = useCallback(async () => {
    if (!openAICodexDeviceSession) {
      setOpenAICodexStatusMessage(t('Start device authorization first.'))
      return
    }
    if (Date.now() >= openAICodexDeviceSession.expiresAt) {
      setOpenAICodexDeviceState('expired')
      setOpenAICodexStatusMessage(t('Device authorization has expired. Start again to get a new code.'))
      return
    }

    setIsOpenAICodexAuthRunning(true)
    try {
      const response = await api.pollOpenAICodexDeviceAuth({
        deviceCode: openAICodexDeviceSession.deviceCode
      })
      if (!response.success) {
        setOpenAICodexDeviceState('error')
        setOpenAICodexStatusMessage(response.error || t('Checking device authorization failed'))
        return
      }

      const data = asObjectRecord(response.data)
      const status = asStringValue(data?.status)
      if (status === 'pending') {
        setOpenAICodexDeviceState('pending')
        setOpenAICodexStatusMessage(
          `Authorization is still pending. Please complete it, then check again in ${openAICodexDeviceSession.intervalSec}s.`
        )
        return
      }
      if (status !== 'authorized') {
        setOpenAICodexDeviceState('error')
        setOpenAICodexStatusMessage(t('Unexpected device authorization response.'))
        return
      }

      const applied = await applyOpenAICodexAuthorizedCredential(data)
      if (applied) {
        setOpenAICodexDeviceState('authorized')
      }
    } catch (error) {
      setOpenAICodexDeviceState('error')
      setOpenAICodexStatusMessage(t('Checking device authorization failed'))
    } finally {
      setIsOpenAICodexAuthRunning(false)
    }
  }, [applyOpenAICodexAuthorizedCredential, openAICodexDeviceSession, t])

  const handleAddModelId = () => {
    if (!selectedProfile) return
    const normalizedModel = modelInput.trim()
    if (!normalizedModel) return
    updateSelectedProfile({
      modelCatalog: normalizeModelCatalog(selectedProfile.defaultModel, [...selectedCatalog, normalizedModel])
    })
    setModelInput('')
    setValidationResult(null)
  }

  const toggleModelStep = (step: ModelSetupStep) => {
    setExpandedModelSteps(prev => ({
      ...prev,
      [step]: !prev[step]
    }))
  }

  const openModelStep = (step: ModelSetupStep) => {
    setExpandedModelSteps(prev => (
      prev[step]
        ? prev
        : {
            ...prev,
            [step]: true
          }
    ))
  }

  const closeModelStep = (step: ModelSetupStep) => {
    setExpandedModelSteps(prev => (
      prev[step]
        ? {
            ...prev,
            [step]: false
          }
        : prev
    ))
  }

  const createProfileFromTemplate = (templateKey?: string) => {
    const template = AI_PROFILE_TEMPLATES.find(item => item.key === templateKey) || AI_PROFILE_TEMPLATES[0]
    const profileName = toUniqueProfileName(template.label, profiles)
    const profileId = templateKey ? `preset-${template.key}` : createProfileId(template.key)
    const nextProfile: ApiProfile = {
      id: profileId,
      name: profileName,
      apiKey: '',
      enabled: false,
      presetKey: template.presetKey,
      vendor: template.vendor,
      protocol: template.protocol,
      apiUrl: template.apiUrl,
      defaultModel: template.defaultModel,
      modelCatalog: template.modelCatalog,
      docUrl: template.docUrl,
      openAICodexAuthMode: template.vendor === 'openai' && template.protocol === 'openai_compat'
        ? 'api_key'
        : undefined,
      openAICodexTenantId: template.vendor === 'openai' && template.protocol === 'openai_compat'
        ? OPENAI_CODEX_DEFAULT_TENANT_ID
        : undefined,
      openAICodexAccountId: undefined
    }

    setProfiles(prevProfiles => [...prevProfiles, nextProfile])
    setSelectedProfileId(profileId)
    if (!defaultProfileId) {
      setDefaultProfileId(profileId)
    }
    setValidationResult(null)
  }

  const handleAddProfileFromTemplate = () => {
    if (!firstMissingTemplateKey) return
    createProfileFromTemplate(firstMissingTemplateKey)
  }

  const handleSelectProviderTemplate = (templateKey: string) => {
    const template = AI_PROFILE_TEMPLATES.find(item => item.key === templateKey)
    if (!template) return

    const existingProfile = profiles.find(profile => resolveTemplateKeyFromProfile(profile) === template.key)
    if (existingProfile) {
      setSelectedProfileId(existingProfile.id)
      setValidationResult(null)
      openModelStep('account')
      closeModelStep('model')
      return
    }

    if (selectedProfile && isProfileUnconfigured(selectedProfile)) {
      updateSelectedProfile({
        name: toUniqueProfileName(template.label, profiles.filter(profile => profile.id !== selectedProfile.id)),
        presetKey: template.presetKey,
        vendor: template.vendor,
        protocol: template.protocol,
        apiUrl: template.apiUrl,
        apiKey: '',
        defaultModel: template.defaultModel,
        modelCatalog: template.modelCatalog,
        docUrl: template.docUrl,
        openAICodexAuthMode: template.vendor === 'openai' && template.protocol === 'openai_compat'
          ? 'api_key'
          : undefined,
        openAICodexTenantId: template.vendor === 'openai' && template.protocol === 'openai_compat'
          ? OPENAI_CODEX_DEFAULT_TENANT_ID
          : undefined,
        openAICodexAccountId: undefined,
        enabled: true
      })
      setValidationResult(null)
      openModelStep('account')
      closeModelStep('model')
      return
    }

    createProfileFromTemplate(template.key)
    openModelStep('account')
    closeModelStep('model')
  }

  const handleRemoveSelectedProfile = () => {
    if (!selectedProfile) return
    if (profiles.length <= 1) return

    const nextProfiles = profiles.filter(profile => profile.id !== selectedProfile.id)
    const nextSelected = nextProfiles[0]?.id || ''
    const nextDefault =
      selectedProfile.id === defaultProfileId
        ? nextSelected
        : defaultProfileId

    setProfiles(nextProfiles)
    setSelectedProfileId(nextSelected)
    setDefaultProfileId(nextDefault)
    setValidationResult(null)
  }

  const parseValidationResult = (response: { success: boolean; data?: unknown; error?: string }) => {
    const data = response.data as Partial<ApiValidationResult> | undefined
    const valid = typeof data?.valid === 'boolean' ? data.valid : response.success
    return {
      valid,
      message: data?.message || response.error,
      model: data?.model,
      resolvedModel: data?.resolvedModel,
      availableModels: Array.isArray(data?.availableModels) ? data.availableModels : [],
      manualModelInputRequired: data?.manualModelInputRequired === true,
      connectionSummary: data?.connectionSummary
    } satisfies ApiValidationResult
  }

  const resolveOpenAICodexValidationMessage = (errorCode?: string, fallback?: string): string => {
    if (errorCode === 'session_not_found') {
      return 'ChatGPT 授权不存在或已失效，请重新连接账号。'
    }
    if (errorCode === 'refresh_error') {
      return 'ChatGPT 授权刷新失败，请重新连接账号。'
    }
    if (errorCode === 'model_not_allowed') {
      return '当前账号无权使用该模型，请切换模型或账号后重试。'
    }
    if (errorCode === 'oauth_exchange_error') {
      return fallback || t('ChatGPT authorization check failed.')
    }
    return fallback || t('ChatGPT authorization check failed.')
  }

  const handleValidateConnection = async () => {
    if (!selectedProfile) return

    if (isOpenAICodexMode) {
      setIsValidating(true)
      if (!selectedProfile.apiKey.trim()) {
        setValidationResult({
          valid: false,
          message: t('Complete ChatGPT authorization first.'),
          availableModels: [],
          manualModelInputRequired: false
        })
        setIsValidating(false)
        return
      }

      try {
        const response = await api.validateOpenAICodexSession({
          tenantId: openAICodexTenantId.trim() || OPENAI_CODEX_DEFAULT_TENANT_ID,
          accountId: openAICodexAccountId.trim() || undefined,
          fallbackAccessToken: selectedProfile.apiKey.trim(),
          authMode: openAICodexAuthMode,
          modelId: selectedProfile.defaultModel.trim() || 'gpt-5-codex'
        })
        if (!response.success) {
          const message = resolveOpenAICodexValidationMessage(response.errorCode, response.error)
          setValidationResult({
            valid: false,
            message,
            availableModels: [],
            manualModelInputRequired: false
          })
          return
        }
        const data = asObjectRecord(response.data)
        const modelProbe = asObjectRecord(data?.modelProbe)
        const modelProbeMessage = asStringValue(modelProbe?.message)
        const validatedAccountId = asStringValue(data?.accountId)
        if (!validatedAccountId) {
          setValidationResult({
            valid: false,
            message: t('Missing ChatGPT Account ID, please reconnect your account.'),
            availableModels: [],
            manualModelInputRequired: false
          })
          return
        }

        if (validatedAccountId !== openAICodexAccountId.trim()) {
          setOpenAICodexAccountId(validatedAccountId)
          updateSelectedProfile({ openAICodexAccountId: validatedAccountId })
        }

        setValidationResult({
          valid: true,
          message: modelProbeMessage || t('ChatGPT authorization is ready. You can save this account now.'),
          connectionSummary: modelProbeMessage || t('ChatGPT authorization is ready. You can save this account now.'),
          availableModels: selectedCatalog.length > 0 ? selectedCatalog : ['gpt-5-codex'],
          manualModelInputRequired: false,
          resolvedModel: selectedProfile.defaultModel || 'gpt-5-codex'
        })
        openModelStep('model')
      } finally {
        setIsValidating(false)
      }
      return
    }

    if (selectedProfile.enabled !== false && !selectedProfile.apiKey.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API Key'), availableModels: [], manualModelInputRequired: false })
      return
    }

    if (selectedProfile.protocol !== 'anthropic_official' && !selectedProfile.apiUrl.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API URL'), availableModels: [], manualModelInputRequired: false })
      return
    }

    if (selectedProfileUrlInvalid) {
      setValidationResult({
        valid: false,
        message: selectedProfileUrlError || t('Please enter API URL'),
        availableModels: [],
        manualModelInputRequired: false
      })
      return
    }

    setIsValidating(true)
    setValidationResult(null)
    const validateStartedAt = Date.now()

    try {
      let response = await api.validateApi(
        selectedProfile.apiKey.trim(),
        selectedProfile.apiUrl.trim(),
        selectedProfile.vendor,
        selectedProfile.protocol,
        selectedProfile.defaultModel.trim()
      )
      let parsed = parseValidationResult(response as { success: boolean; data?: unknown; error?: string })

      // Backward compatibility: old backends only understand provider=openai for OpenAI-compatible validation.
      if (!parsed.valid && selectedProfile.protocol === 'openai_compat') {
        response = await api.validateApi(
          selectedProfile.apiKey.trim(),
          selectedProfile.apiUrl.trim(),
          'openai',
          selectedProfile.protocol,
          selectedProfile.defaultModel.trim()
        )
        parsed = parseValidationResult(response as { success: boolean; data?: unknown; error?: string })
      }

      // 成功时保留最小加载时长，避免“瞬间闪过”导致反馈不明显。
      if (parsed.valid) {
        const SUCCESS_MIN_DURATION_MS = 900
        const elapsed = Date.now() - validateStartedAt
        if (elapsed < SUCCESS_MIN_DURATION_MS) {
          await new Promise(resolve => setTimeout(resolve, SUCCESS_MIN_DURATION_MS - elapsed))
        }
      }

      if (parsed.valid) {
        const nextCatalog = parsed.availableModels.length > 0
          ? normalizeModelCatalog(
              parsed.resolvedModel || selectedProfile.defaultModel,
              parsed.availableModels
            )
          : selectedCatalog

        updateSelectedProfile({
          defaultModel: parsed.resolvedModel || selectedProfile.defaultModel,
          modelCatalog: nextCatalog
        })
        openModelStep('model')
      }

      setValidationResult({
        ...parsed,
        message: parsed.valid
          ? (parsed.connectionSummary || parsed.message || t('Connection successful'))
          : (parsed.message || t('Connection failed'))
      })
    } catch (error) {
      setValidationResult({
        valid: false,
        message: t('Connection failed'),
        availableModels: [],
        manualModelInputRequired: false
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleSave = async () => {
    if (profiles.length === 0) {
      setValidationResult({ valid: false, message: t('Please create at least one profile'), availableModels: [], manualModelInputRequired: false })
      return
    }

    if (!selectedProfile) {
      setValidationResult({ valid: false, message: t('Please select a profile'), availableModels: [], manualModelInputRequired: false })
      return
    }

    if (!selectedProfile.apiKey.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API Key'), availableModels: [], manualModelInputRequired: false })
      return
    }

    if (selectedProfile.protocol !== 'anthropic_official' && !selectedProfile.apiUrl.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API URL'), availableModels: [], manualModelInputRequired: false })
      return
    }

    if (selectedProfileUrlInvalid) {
      setValidationResult({
        valid: false,
        message: selectedProfileUrlError || t('Please enter API URL'),
        availableModels: [],
        manualModelInputRequired: false
      })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const persisted = await persistAiProfiles(profiles, defaultProfileId)
      const persistedSelectedProfile = persisted.normalizedProfiles.find(profile => profile.id === selectedProfile.id) || selectedProfile
      setValidationResult({
        valid: true,
        message: t('Model connected, you can start chatting'),
        connectionSummary: t('Model connected, you can start chatting'),
        availableModels: normalizeModelCatalog(persistedSelectedProfile.defaultModel, persistedSelectedProfile.modelCatalog),
        manualModelInputRequired: false,
        resolvedModel: persistedSelectedProfile.defaultModel
      })
    } catch (error) {
      setValidationResult({
        valid: false,
        message: t('Save failed'),
        availableModels: [],
        manualModelInputRequired: false
      })
    } finally {
      setIsValidating(false)
    }
  }

  const currentLanguage = getCurrentLanguage()
  const localeEntries = Object.entries(SUPPORTED_LOCALES) as [LocaleCode, string][]
  const activeSectionMeta = SETTINGS_SECTIONS.find(section => section.id === activeSection) || SETTINGS_SECTIONS[0]
  const groupedSections = SETTINGS_SECTION_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id)
  }))
  const formatCheckTime = (value?: string | null): string => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
  }

  const getUpdateStatusLabel = (): string => {
    if (!updaterState) return '-'
    if (updaterState.status === 'checking' || isCheckingUpdate) return t('Checking for updates...')
    if (updaterState.status === 'available') return t('Update available')
    if (updaterState.status === 'not-available') return t('Already up to date')
    if (updaterState.status === 'error') return t('Update check failed')
    return updaterState.message || '-'
  }

  const renderModelSection = () => {
    const hasProfile = Boolean(selectedProfile)
    const hasApiKey = Boolean(selectedProfile?.apiKey.trim())
    const requiresApiUrl = Boolean(selectedProfile && selectedTemplate?.apiUrlBehavior === 'required')
    const hasApiUrl = !requiresApiUrl || Boolean(selectedProfile?.apiUrl.trim())
    const hasDefaultModel = Boolean(selectedProfile?.defaultModel.trim())
    const providerReady = hasProfile
    const accountReady = hasApiKey && hasApiUrl
    const modelReady = hasDefaultModel
    const completedSteps = [hasProfile, hasApiKey && hasApiUrl, hasDefaultModel].filter(Boolean).length
    const profileStatusKey = hasApiKey ? 'Connected now' : 'Needs connection'
    const isOpenAICodexConnected = isOpenAICodexMode && hasApiKey
    const openAICodexConnectedAccountId = openAICodexAccountId.trim()
    const modelChoices = validationResult?.availableModels?.length
      ? validationResult.availableModels
      : (selectedTemplate?.recommendedModels.length ? selectedTemplate.recommendedModels : selectedCatalog)
    const canTestConnection = Boolean(
      selectedProfile &&
      selectedProfile.enabled !== false &&
      hasApiKey &&
      hasApiUrl &&
      !selectedProfileUrlInvalid
    )
    const canSaveModel = Boolean(
      selectedProfile &&
      !selectedProfileUrlInvalid &&
      (selectedProfile.enabled === false || (hasApiKey && hasApiUrl))
    )

    return (
      <section className="settings-modal-card settings-model-shell">
        <div className="settings-model-layout">
          <aside className="settings-model-sidebar">
            <section className="settings-profile-card">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{t('Other connected accounts')}</label>
                <button
                  type="button"
                  onClick={handleAddProfileFromTemplate}
                  disabled={!canAddProfileFromTemplate}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xl leading-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                  title={t('Add account')}
                >
                  +
                </button>
              </div>
              <div className="mb-3 flex items-center justify-between rounded-xl border border-border/70 bg-card px-3 py-2">
                <span className="text-xs text-muted-foreground">{t('Start in 3 simple steps')}</span>
                <span className="text-sm font-semibold">{completedSteps}/3</span>
              </div>
              <div className="space-y-1.5">
                {profiles.map((profile) => {
                  const selected = profile.id === selectedProfileId
                  const enabled = profile.enabled !== false
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => {
                        setSelectedProfileId(profile.id)
                        setValidationResult(null)
                      }}
                      className={`settings-profile-item ${selected ? 'settings-profile-item-active' : ''}`}
                    >
                      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                        {getProfileMonogram(profile.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{profile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {enabled ? t('Enabled') : t('Disabled')}
                        </p>
                      </div>
                      <div className={`h-2 w-2 rounded-full ${enabled ? 'bg-kite-success' : 'bg-muted-foreground/40'}`} />
                    </button>
                  )
                })}
              </div>
            </section>
          </aside>

          <section className="settings-model-content">
            {!selectedProfile ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                {t('Please create or select a profile')}
              </div>
            ) : (
              <div className="space-y-4">
                <section className="settings-step-card">
                  <div className="settings-step-head">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t('Model setup')}</p>
                      <h3 className="mt-1 text-xl font-semibold">{selectedTemplate?.label || selectedProfile.name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${hasApiKey ? 'bg-kite-success/15 text-kite-success' : 'bg-secondary text-muted-foreground'}`}>
                        {t(profileStatusKey)}
                      </span>
                      <AppleToggle
                        checked={selectedProfile.enabled !== false}
                        onChange={handleSelectedProfileEnabledChange}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t('Choose a provider, connect your account, then pick a model.')}</p>
                </section>

                <section className={`settings-step-card ${!expandedModelSteps.provider ? 'settings-step-card-collapsed' : ''}`}>
                  <button
                    type="button"
                    onClick={() => toggleModelStep('provider')}
                    className="settings-step-toggle"
                    aria-expanded={expandedModelSteps.provider}
                  >
                    <div className="settings-step-toggle-left">
                      <h4 className="text-sm font-semibold">1. {t('Choose provider')}</h4>
                      <span className="settings-step-status">{t('Step 1: Pick the service you want to connect')}</span>
                    </div>
                    <div className="settings-step-toggle-right">
                      {providerReady && <CheckCircle2 className="h-4 w-4 text-kite-success" />}
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedModelSteps.provider ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {expandedModelSteps.provider && (
                    <div className="settings-step-panel">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {AI_PROFILE_TEMPLATES.map((template) => {
                          const active = selectedProfile.presetKey === template.presetKey
                          return (
                            <button
                              key={template.key}
                              type="button"
                              onClick={() => handleSelectProviderTemplate(template.key)}
                              className={`rounded-xl border p-3 text-left transition ${
                                active
                                  ? 'border-primary/45 bg-primary/10'
                                  : 'border-border bg-background hover:bg-secondary/40'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-foreground">{template.label}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {template.connectionMode === 'custom' ? t('Advanced connection') : t('Recommended for direct setup')}
                                  </p>
                                </div>
                                {active && <CheckCircle2 className="h-4 w-4 text-kite-success shrink-0" />}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </section>

                {selectedProfile.enabled === false ? (
                  <section className="settings-step-card text-center">
                    <p className="text-base font-medium">{t('Disabled')}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{t('Please enable the AI provider in Settings')}</p>
                    <button
                      type="button"
                      onClick={() => handleSelectedProfileEnabledChange(true)}
                      className="mt-4 rounded-xl btn-apple px-4 py-2 text-sm"
                    >
                      {t('Enable')} {selectedProfile.name}
                    </button>
                  </section>
                ) : (
                  <>
                    <section className={`settings-step-card ${!expandedModelSteps.account ? 'settings-step-card-collapsed' : ''}`}>
                      <button
                        type="button"
                        onClick={() => toggleModelStep('account')}
                        className="settings-step-toggle"
                        aria-expanded={expandedModelSteps.account}
                      >
                        <div className="settings-step-toggle-left">
                          <h4 className="text-sm font-semibold">2. {t('Connect account')}</h4>
                          <span className="settings-step-status">
                            {isOpenAIProfile && openAICodexAuthMode !== 'api_key'
                              ? t('Step 2: Authorize your ChatGPT account')
                              : t('Step 2: Add your API Key')}
                          </span>
                        </div>
                        <div className="settings-step-toggle-right">
                          {accountReady && <CheckCircle2 className="h-4 w-4 text-kite-success" />}
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedModelSteps.account ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expandedModelSteps.account && (
                        <div className="settings-step-panel space-y-3">
                          <div className="rounded-xl border border-border/75 bg-secondary/20 p-3">
                            <div className="space-y-2 text-sm">
                              <div>
                                <p className="font-medium text-foreground">{t('What is this?')}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{selectedTemplate?.setupCopy.whatIsThis}</p>
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{t('Where to get it?')}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{selectedTemplate?.setupCopy.whereToGetKey}</p>
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{t('What happens after connecting?')}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{selectedTemplate?.setupCopy.whatHappensAfterConnect}</p>
                              </div>
                            </div>
                            {selectedProfile.docUrl && (
                              <button
                                type="button"
                                onClick={() => void api.openExternal(selectedProfile.docUrl!)}
                                className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="h-4 w-4" />
                                {t('Open API Key guide')}
                              </button>
                            )}
                          </div>

                          <OpenAICodexAuthPanel
                            t={t}
                            isOpenAIProfile={isOpenAIProfile}
                            openAICodexAuthMode={openAICodexAuthMode}
                            isOpenAICodexAuthRunning={isOpenAICodexAuthRunning}
                            openAICodexTenantId={openAICodexTenantId}
                            openAICodexAccountId={openAICodexAccountId}
                            openAICodexBrowserSession={openAICodexBrowserSession}
                            openAICodexBrowserCallbackInput={openAICodexBrowserCallbackInput}
                            openAICodexDeviceSession={openAICodexDeviceSession}
                            openAICodexDeviceState={openAICodexDeviceState}
                            openAICodexStatusMessage={openAICodexStatusMessage}
                            onAuthModeChange={handleOpenAICodexAuthModeChange}
                            onTenantIdChange={handleOpenAICodexTenantIdChange}
                            onAccountIdChange={handleOpenAICodexAccountIdChange}
                            onStartBrowserAuth={handleStartOpenAICodexBrowserAuth}
                            onFinishBrowserAuth={handleFinishOpenAICodexBrowserAuth}
                            onStartDeviceAuth={handleStartOpenAICodexDeviceAuth}
                            onPollDeviceAuth={handlePollOpenAICodexDeviceAuth}
                            onBrowserCallbackInputChange={setOpenAICodexBrowserCallbackInput}
                            onCopyToClipboard={copyToClipboard}
                            onOpenExternal={handleOpenExternal}
                          />

                          {isOpenAICodexConnected ? (
                            <div className="rounded-xl border border-border/75 bg-secondary/20 p-3 text-xs text-muted-foreground">
                              <p className="text-sm font-medium text-foreground">{t('Connected with ChatGPT official account')}</p>
                              <p className="mt-2">{t('Routing endpoint is fixed to ChatGPT backend API and saved automatically.')}</p>
                              {openAICodexConnectedAccountId && (
                                <p className="mt-1 break-all">
                                  {t('Account ID')}: {openAICodexConnectedAccountId}
                                </p>
                              )}
                              <p className="mt-1 break-all">
                                {t('Connection URL')}: {OPENAI_CODEX_RESPONSES_ENDPOINT}
                              </p>
                            </div>
                          ) : (
                            <>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                  {isOpenAICodexMode ? t('Access token') : 'API Key'}
                                </label>
                                <p className="mb-2 text-xs text-muted-foreground">
                                  {isOpenAICodexMode
                                    ? t('This field is auto-filled after ChatGPT authorization. You can still edit it manually.')
                                    : t('Paste the API Key from the provider console')}
                                </p>
                                <div className="relative">
                                  <input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={selectedProfile.apiKey}
                                    onChange={(event) => {
                                      updateSelectedProfile({ apiKey: event.target.value })
                                      setValidationResult(null)
                                    }}
                                    className="w-full input-apple px-4 py-2.5 pr-11 text-sm"
                                    placeholder={isOpenAICodexMode ? t('Authorize first to fill token') : t('Please enter API Key')}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowApiKey(prev => !prev)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    aria-label={showApiKey ? t('Hide API Key') : t('Show API Key')}
                                  >
                                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                </div>
                              </div>

                              <div className="rounded-xl border border-dashed border-border/75 bg-secondary/20 p-3">
                                <button
                                  type="button"
                                  onClick={() => setShowAdvancedConnectionFields(prev => !prev)}
                                  className="flex w-full items-center justify-between text-left"
                                >
                                  <span className="text-sm font-medium">{t('Advanced connection settings')}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {showAdvancedConnectionFields || selectedTemplate?.apiUrlBehavior === 'required' ? t('Hide') : t('Show')}
                                  </span>
                                </button>

                                {(showAdvancedConnectionFields || selectedTemplate?.apiUrlBehavior === 'required') && (
                                  <div className="mt-3 space-y-3">
                                    {selectedTemplate?.connectionMode === 'custom' && (
                                      <div>
                                        <label className="mb-2 block text-xs font-medium text-muted-foreground">{t('Address type')}</label>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updateSelectedProfile({ vendor: 'custom', protocol: 'openai_compat' })
                                              setValidationResult(null)
                                            }}
                                            className={`settings-choice-btn ${selectedProfile.protocol === 'openai_compat' ? 'settings-choice-btn-active' : ''}`}
                                          >
                                            {t('OpenAI compatible address')}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updateSelectedProfile({ vendor: 'custom', protocol: 'anthropic_compat' })
                                              setValidationResult(null)
                                            }}
                                            className={`settings-choice-btn ${selectedProfile.protocol === 'anthropic_compat' ? 'settings-choice-btn-active' : ''}`}
                                          >
                                            {t('Claude compatible address')}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Connection URL')}</label>
                                      <p className="mb-2 text-xs text-muted-foreground">{selectedTemplate?.setupCopy.apiUrlHelp}</p>
                                      <input
                                        type="text"
                                        value={selectedProfile.apiUrl}
                                        onChange={(event) => {
                                          updateSelectedProfile({ apiUrl: event.target.value })
                                          setValidationResult(null)
                                        }}
                                        className="w-full input-apple px-4 py-2.5 text-sm"
                                      />
                                      {selectedProfileUrlInvalid && (
                                        <p className="mt-1 text-xs text-destructive">{selectedProfileUrlError}</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </section>

                    <section className={`settings-step-card ${!expandedModelSteps.model ? 'settings-step-card-collapsed' : ''}`}>
                      <button
                        type="button"
                        onClick={() => toggleModelStep('model')}
                        className="settings-step-toggle"
                        aria-expanded={expandedModelSteps.model}
                      >
                        <div className="settings-step-toggle-left">
                          <h4 className="text-sm font-semibold">3. {t('Choose model')}</h4>
                          <span className="settings-step-status">{t('Step 3: Pick the model used for chat')}</span>
                        </div>
                        <div className="settings-step-toggle-right">
                          {modelReady && <CheckCircle2 className="h-4 w-4 text-kite-success" />}
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedModelSteps.model ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expandedModelSteps.model && (
                        <div className="settings-step-panel space-y-3">
                          <div>
                            <p className="mb-2 text-xs text-muted-foreground">
                              {validationResult?.valid
                                ? (validationResult.manualModelInputRequired
                                    ? t('The service did not return a model list. Enter the model name manually.')
                                    : t('Choose the model buddykite should use for chat.'))
                                : (selectedTemplate?.setupCopy.modelHelp || t('Verify the connection first, then choose a model.'))}
                            </p>
                            {modelChoices.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {modelChoices.map((modelId) => (
                                  <button
                                    key={modelId}
                                    type="button"
                                    onClick={() => {
                                      updateSelectedProfile({
                                        defaultModel: modelId,
                                        modelCatalog: normalizeModelCatalog(modelId, selectedCatalog.length > 0 ? selectedCatalog : modelChoices)
                                      })
                                      setValidationResult(null)
                                    }}
                                    className={`rounded-full border px-2.5 py-1 text-xs ${
                                      modelId === selectedProfile.defaultModel
                                        ? 'border-primary/45 bg-primary/10 text-primary'
                                        : 'border-border bg-background text-muted-foreground hover:bg-secondary/40'
                                    }`}
                                  >
                                    {modelId}
                                  </button>
                                ))}
                              </div>
                            )}
                            <input
                              type="text"
                              value={selectedProfile.defaultModel}
                              onChange={(event) => {
                                const previousDefaultModel = selectedProfile.defaultModel
                                const nextDefaultModel = event.target.value
                                updateSelectedProfile({
                                  defaultModel: nextDefaultModel,
                                  modelCatalog: normalizeModelCatalogForDefaultModelChange(
                                    nextDefaultModel,
                                    previousDefaultModel,
                                    selectedCatalog
                                  )
                                })
                                setValidationResult(null)
                              }}
                              className="w-full input-apple px-4 py-2.5 text-sm"
                            />
                          </div>

                          <div className="rounded-xl border border-dashed border-border/75 bg-secondary/20 p-3">
                            <button
                              type="button"
                              onClick={() => setShowAdvancedModelFields((prev) => !prev)}
                              className="flex w-full items-center justify-between text-left"
                            >
                              <span className="text-sm font-medium">{t('Advanced options')}</span>
                              <span className="text-xs text-muted-foreground">
                                {showAdvancedModelFields ? t('Hide') : t('Show')}
                              </span>
                            </button>

                            {showAdvancedModelFields && (
                              <div className="mt-3 space-y-3">
                                <div>
                                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Extra model list')}</label>
                                  <div className="mb-2 flex flex-wrap gap-1.5">
                                    {selectedCatalog.map((modelId) => (
                                      <button
                                        type="button"
                                        key={modelId}
                                        onClick={() => {
                                          if (modelId === selectedProfile.defaultModel) return
                                          updateSelectedProfile({
                                            modelCatalog: selectedCatalog.filter(item => item !== modelId)
                                          })
                                        }}
                                        className={`rounded-full border px-2.5 py-1 text-xs ${
                                          modelId === selectedProfile.defaultModel
                                            ? 'cursor-default border-primary/45 bg-primary/10 text-primary'
                                            : 'border-border bg-background text-muted-foreground hover:bg-secondary/50'
                                        }`}
                                      >
                                        {modelId}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      value={modelInput}
                                      onChange={(event) => setModelInput(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          handleAddModelId()
                                        }
                                      }}
                                      className="w-full input-apple px-4 py-2 text-sm"
                                      placeholder={t('Add model id')}
                                    />
                                    <button
                                      type="button"
                                      onClick={handleAddModelId}
                                      className="rounded-xl border border-border/70 px-3 text-sm hover:bg-secondary/50"
                                    >
                                      {t('Add')}
                                    </button>
                                  </div>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Documentation link')}</label>
                                  <input
                                    type="text"
                                    value={selectedProfile.docUrl || ''}
                                    onChange={(event) => {
                                      updateSelectedProfile({ docUrl: event.target.value })
                                      setValidationResult(null)
                                    }}
                                    className="w-full input-apple px-4 py-2.5 text-sm"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  </>
                )}

                <section className="settings-action-row">
                  <div className="settings-action-main">
                    <div className="settings-action-summary">
                      <p className="settings-action-label">{t('Ready to apply this account?')}</p>
                      <p className="settings-action-hint">
                        {selectedProfile.id === defaultProfileId
                          ? t('This account is currently the default for new conversations.')
                          : t('You can save first, then decide whether to make it the default account.')}
                      </p>
                    </div>

                    <div className="settings-action-buttons">
                      <button
                        type="button"
                        onClick={() => selectedProfile.enabled !== false && setDefaultProfileId(selectedProfile.id)}
                        className={`settings-action-button settings-action-button-ghost ${
                          selectedProfile.id === defaultProfileId ? 'settings-action-button-active' : ''
                        }`}
                        disabled={selectedProfile.enabled === false}
                      >
                        <Star className="h-4 w-4" />
                        <span>{selectedProfile.id === defaultProfileId ? t('Default') : t('Set as Default')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleValidateConnection()}
                        className="settings-action-button settings-action-button-secondary"
                        disabled={isValidating || !canTestConnection}
                      >
                        <span>{isValidating ? t('Testing...') : t('Verify connection')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        className="settings-action-button settings-action-button-primary"
                        disabled={isValidating || !canSaveModel}
                      >
                        <span>{isValidating ? t('Saving...') : t('Save and finish')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="settings-action-secondary">
                    {validationResult?.valid && (
                      <button
                        type="button"
                        onClick={goBack}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/50"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        {t('Return to conversation')}
                      </button>
                    )}
                  </div>

                  <div className="settings-danger-card">
                    <div>
                      <p className="settings-danger-title">{t('Delete this account')}</p>
                      <p className="settings-danger-hint">{t('Only this saved account will be removed. Other accounts stay unchanged.')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveSelectedProfile}
                      className="settings-danger-button"
                      disabled={profiles.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{t('Delete')}</span>
                    </button>
                  </div>

                  {validationResult?.message && (
                    <div
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                        validationResult.valid
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-red-200 bg-red-50 text-red-600'
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      {validationResult.valid ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span>{validationResult.message}</span>
                    </div>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      </section>
    )
  }

  const renderAppearanceSection = () => (
    <div className="settings-section-stack">
      <section className="settings-modal-card settings-block-card">
        <div className="settings-block-head">
          <h3 className="text-base font-semibold tracking-tight">{t('Theme')}</h3>
          <p className="text-xs text-muted-foreground">{t('Adjust theme and language')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:max-w-[360px]">
          {THEME_OPTIONS.map((themeOption) => (
            <button
              key={themeOption.value}
              onClick={() => handleThemeChange(themeOption.value)}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                theme === themeOption.value
                  ? 'bg-secondary text-foreground ring-2 ring-foreground/15'
                  : 'bg-secondary/50 text-foreground/75 hover:bg-secondary/80'
              }`}
            >
              {t(themeOption.labelKey)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-modal-card settings-block-card">
        <div className="settings-block-head">
          <h3 className="text-base font-semibold tracking-tight">{t('Chat width')}</h3>
          <p className="text-xs text-muted-foreground">{t('Use one shared width for messages and composer')}</p>
        </div>
        <div className="space-y-3">
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Auto width')}</p>
              <p className="text-sm text-muted-foreground">clamp(860px, 72vw, 1280px)</p>
            </div>
            <AppleToggle
              checked={chatLayoutMode === 'auto'}
              onChange={(checked) => {
                void handleChatLayoutModeChange(checked)
              }}
            />
          </div>

          {chatLayoutMode === 'manual' && (
            <div className="settings-setting-row">
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{t('Manual max width')}</p>
                  <span className="text-sm text-muted-foreground">{manualChatWidthPx}px</span>
                </div>
                <input
                  type="range"
                  min={CHAT_LAYOUT_WIDTH_MIN}
                  max={CHAT_LAYOUT_WIDTH_MAX}
                  step={CHAT_LAYOUT_WIDTH_STEP}
                  value={manualChatWidthPx}
                  onChange={(event) => {
                    handleManualChatWidthDraftChange(Number(event.target.value))
                  }}
                  onMouseUp={(event) => {
                    void handleManualChatWidthCommit(Number((event.currentTarget as HTMLInputElement).value))
                  }}
                  onTouchEnd={(event) => {
                    void handleManualChatWidthCommit(Number((event.currentTarget as HTMLInputElement).value))
                  }}
                  onBlur={(event) => {
                    void handleManualChatWidthCommit(Number((event.currentTarget as HTMLInputElement).value))
                  }}
                  className="mt-2 w-full accent-[hsl(var(--primary))]"
                />
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground/80">
                  <span>{CHAT_LAYOUT_WIDTH_MIN}px</span>
                  <span>{CHAT_LAYOUT_WIDTH_MAX}px</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="settings-modal-card settings-block-card">
        <div className="settings-block-head">
          <h3 className="text-base font-semibold tracking-tight">{t('Language')}</h3>
          <p className="text-xs text-muted-foreground">{t('Pick required setup first, then optional improvements')}</p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {localeEntries.map(([code, name]) => (
              <button
                key={code}
                type="button"
                onClick={() => handleLanguageChange(code)}
                className={`rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
                  currentLanguage === code
                    ? 'bg-secondary text-foreground ring-2 ring-foreground/15'
                    : 'bg-secondary/50 text-foreground/75 hover:bg-secondary/80'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <select
            value={currentLanguage}
            onChange={(event) => handleLanguageChange(event.target.value as LocaleCode)}
            className="w-full input-apple px-4 py-2.5 text-sm"
          >
            {localeEntries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  )

  const renderGeneralSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head">
        <h3 className="text-base font-semibold tracking-tight">{t('System')}</h3>
        <p className="text-xs text-muted-foreground">{t('Tune app behavior')}</p>
      </div>
      {api.isRemoteMode() ? (
        <p className="text-sm text-muted-foreground">{t('System settings are unavailable in remote mode')}</p>
      ) : (
        <div className="space-y-3">
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Starter experience')}</p>
              <p className="text-sm text-muted-foreground">{t('Show starter cards and quick-start actions')}</p>
            </div>
            <AppleToggle
              checked={!(
                config?.onboarding?.starterExperienceHidden === true
                || config?.onboarding?.homeGuideHidden === true
              )}
              onChange={handleStarterExperienceVisibilityChange}
            />
          </div>
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Auto Launch on Startup')}</p>
              <p className="text-sm text-muted-foreground">{t('Automatically run Kite when system starts')}</p>
            </div>
            <AppleToggle checked={autoLaunch} onChange={handleAutoLaunchChange} />
          </div>
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Background Daemon')}</p>
              <p className="text-sm text-muted-foreground">
                {t('Minimize to {{trayType}} when closing window, instead of exiting the program', {
                  trayType: window.platform?.isMac ? t('menu bar') : t('system tray')
                })}
              </p>
            </div>
            <AppleToggle checked={minimizeToTray} onChange={handleMinimizeToTrayChange} />
          </div>
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Slash 运行模式')}</p>
              <p className="text-sm text-muted-foreground">
                {t('默认使用原生模式；切换后从新一轮对话开始生效')}
              </p>
            </div>
            <select
              value={slashRuntimeMode}
              onChange={(event) => handleSlashRuntimeModeChange(event.target.value as ClaudeCodeSlashRuntimeMode)}
              disabled={isSavingSlashRuntimeMode}
              className="input-apple min-w-[190px] px-3 py-2 text-sm"
            >
              <option value="native">{t('原生（推荐）')}</option>
              <option value="legacy-inject">{t('回退（legacy-inject）')}</option>
            </select>
          </div>
        </div>
      )}
    </section>
  )

  const renderPermissionSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head-row">
        <h3 className="text-base font-semibold tracking-tight">{t('Permissions')}</h3>
        <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
          {t('Full Permission Mode')}
        </span>
      </div>

      <div className="settings-info mb-5 text-sm text-muted-foreground">
        {t('Current version defaults to full permission mode, AI can freely perform all operations. Future versions will support fine-grained permission control.')}
      </div>

      <div className="space-y-4 opacity-60">
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('File Read/Write')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow AI to read and create files')}</p>
          </div>
          <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
            {t('Allow')}
          </span>
        </div>
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('Execute Commands')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow AI to execute terminal commands')}</p>
          </div>
          <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
            {t('Allow')}
          </span>
        </div>
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('Trust Mode')}</p>
            <p className="text-sm text-muted-foreground">{t('Automatically execute all operations')}</p>
          </div>
          <AppleToggle checked={true} onChange={() => {}} disabled={true} />
        </div>
      </div>
    </section>
  )

  const renderMcpSection = () => (
    <section className="settings-modal-card settings-block-card">
      <McpServerList
        servers={config?.mcpServers || {}}
        onSave={handleMcpServersSave}
      />
      <div className="mt-5 border-t border-border/50 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('Format compatible with Cursor / Claude Desktop')}</span>
          <a
            href="https://modelcontextprotocol.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-foreground transition-colors hover:text-foreground/80"
          >
            {t('Learn about MCP')} →
          </a>
        </div>
        <p className="text-xs text-amber-500/80">
          ⚠️ {t('Configuration changes will take effect after starting a new conversation')}
        </p>
      </div>
    </section>
  )

  const renderNetworkSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head">
        <h3 className="text-base font-semibold tracking-tight">{t('Remote Access')}</h3>
        <p className="text-xs text-muted-foreground">{t('Enable remote access')}</p>
      </div>

      <div className="settings-warning mb-5">
        <div className="flex items-start gap-3">
          <span className="text-xl text-amber-500">⚠️</span>
          <div className="text-sm">
            <p className="mb-1 font-medium text-amber-500">{t('Security Warning')}</p>
            <p className="text-amber-500/80">
              {t('After enabling remote access, anyone with the password can fully control your computer (read/write files, execute commands). Do not share the access password with untrusted people.')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('Enable Remote Access')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow access to Kite from other devices')}</p>
          </div>
          <AppleToggle
            checked={remoteStatus?.enabled || false}
            onChange={handleToggleRemote}
            disabled={isEnablingRemote}
          />
        </div>

        {remoteStatus?.enabled && (
          <>
            <div className="space-y-3 rounded-lg bg-secondary/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('Local Address')}</span>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-background px-2 py-1 text-sm">{remoteStatus.server.localUrl}</code>
                  <button
                    onClick={() => copyToClipboard(remoteStatus.server.localUrl || '')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('Copy')}
                  </button>
                </div>
              </div>

              {remoteStatus.server.lanUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t('LAN Address')}</span>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-background px-2 py-1 text-sm">{remoteStatus.server.lanUrl}</code>
                    <button
                      onClick={() => copyToClipboard(remoteStatus.server.lanUrl || '')}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t('Copy')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('Access Password')}</span>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-background px-2 py-1 font-mono text-sm tracking-wider">
                    {showPassword ? remoteStatus.server.token : '••••••'}
                  </code>
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? t('Hide') : t('Show')}
                  </button>
                  <button
                    onClick={() => copyToClipboard(remoteStatus.server.token || '')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('Copy')}
                  </button>
                </div>
              </div>

              {remoteStatus.clients > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('Connected Devices')}</span>
                  <span className="text-green-500">{t('{{count}} devices', { count: remoteStatus.clients })}</span>
                </div>
              )}
            </div>

            <div className="border-t border-border/50 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Internet Access')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('Get public address via Cloudflare (wait about 10 seconds for DNS resolution after startup)')}
                  </p>
                </div>
                <button
                  onClick={handleToggleTunnel}
                  disabled={isEnablingTunnel}
                  className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                    remoteStatus.tunnel.status === 'running'
                      ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                      : 'bg-secondary text-foreground hover:bg-secondary/80'
                  }`}
                >
                  {isEnablingTunnel
                    ? t('Connecting...')
                    : remoteStatus.tunnel.status === 'running'
                    ? t('Stop Tunnel')
                    : remoteStatus.tunnel.status === 'starting'
                    ? t('Connecting...')
                    : t('Start Tunnel')}
                </button>
              </div>

              {remoteStatus.tunnel.status === 'running' && remoteStatus.tunnel.url && (
                <div className="space-y-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-green-500">{t('Public Address')}</span>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-background px-2 py-1 text-sm text-green-500">{remoteStatus.tunnel.url}</code>
                      <button
                        onClick={() => copyToClipboard(remoteStatus.tunnel.url || '')}
                        className="text-xs text-green-500/80 hover:text-green-500"
                      >
                        {t('Copy')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {remoteStatus.tunnel.status === 'error' && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-sm text-red-500">
                    {t('Tunnel connection failed')}: {remoteStatus.tunnel.error}
                  </p>
                </div>
              )}
            </div>

            {qrCode && (
              <div className="border-t border-border/50 pt-4">
                <p className="mb-3 font-medium">{t('Scan to Access')}</p>
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-xl bg-white p-3">
                    <img src={qrCode} alt="QR Code" className="h-48 w-48" />
                  </div>
                  <div className="text-center text-sm">
                    <p className="text-muted-foreground">{t('Scan the QR code with your phone and enter the password to access')}</p>
                    <p className="mt-1 text-xs text-amber-500">{t('QR code contains password, do not share screenshots with others')}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )

  const renderAboutSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head">
        <h3 className="text-base font-semibold tracking-tight">{t('About')}</h3>
        <p className="text-xs text-muted-foreground">{t('Check version and updates')}</p>
      </div>
      {api.isRemoteMode() ? (
        <p className="text-sm text-muted-foreground">{t('System settings are unavailable in remote mode')}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Current version')}</span>
            <span>{updaterState?.currentVersion || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Latest version')}</span>
            <span>{updaterState?.latestVersion || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Last checked at')}</span>
            <span>{formatCheckTime(updaterState?.checkTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Status')}</span>
            <span>{getUpdateStatusLabel()}</span>
          </div>
          {updaterState?.downloadSource === 'baidu' && updaterState.baiduExtractCode && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('Extract code')}</span>
              <span className="font-mono">{updaterState.baiduExtractCode}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
            <button
              type="button"
              onClick={() => void handleCheckUpdates()}
              className="inline-flex items-center gap-2 rounded-xl border border-border/70 px-4 py-2 text-sm hover:bg-secondary/50 disabled:opacity-50"
              disabled={isCheckingUpdate}
            >
              <RefreshCw className={`h-4 w-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              {t('Check for updates')}
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadUpdate()}
              className="inline-flex items-center gap-2 rounded-xl btn-apple px-4 py-2 text-sm disabled:opacity-50"
              disabled={updaterState?.status !== 'available'}
            >
              <Download className="h-4 w-4" />
              {t('Download update')}
            </button>
          </div>
        </div>
      )}
    </section>
  )

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'model':
        return renderModelSection()
      case 'appearance':
        return renderAppearanceSection()
      case 'general':
        return renderGeneralSection()
      case 'permissions':
        return renderPermissionSection()
      case 'mcp':
        return renderMcpSection()
      case 'network':
        return renderNetworkSection()
      case 'about':
      default:
        return renderAboutSection()
    }
  }

  return (
    <div className="settings-modal-page">
      <div className="settings-modal-overlay" />
      <div className="settings-modal-shell">
        <aside className="settings-modal-sidebar">
          <div className="settings-modal-sidebar-title">
            <p className="text-sm font-semibold tracking-tight">{t('Settings')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('Pick required setup first, then optional improvements')}</p>
          </div>

          <nav className="space-y-3">
            {groupedSections.map((group) => (
              <div key={group.id} className="space-y-1">
                <p className="px-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t(group.labelKey)}
                </p>
                {group.sections.map((section) => {
                  const Icon = section.icon
                  const selected = section.id === activeSection
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={`settings-modal-nav-item ${selected ? 'settings-modal-nav-item-active' : ''}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1 text-left text-sm font-medium">{t(section.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>

        <section className="settings-modal-main">
          <header className="settings-modal-header">
            <div>
              <span className="settings-header-chip">{t(activeSectionMeta.group === 'required' ? 'Must configure' : activeSectionMeta.group === 'optional' ? 'Optional enhancements' : 'Advanced tools')}</span>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t(activeSectionMeta.labelKey)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t(activeSectionMeta.hintKey)}</p>
            </div>
            <button
              type="button"
              onClick={goBack}
              className="settings-modal-close"
              aria-label={t('Close')}
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className={activeSection === 'model' ? 'settings-modal-content settings-modal-content-model' : 'settings-modal-content'}>
            {renderActiveSection()}
          </div>

          <footer className="settings-modal-footer">
            <button
              type="button"
              onClick={goBack}
              className="btn-apple rounded-2xl px-6 py-2.5 text-sm"
            >
              {t('Done')}
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}
