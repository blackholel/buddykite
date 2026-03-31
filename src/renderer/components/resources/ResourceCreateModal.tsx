import { useMemo, useState } from 'react'
import { Bot, Sparkles, Wand2, X, Zap } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/app.store'
import { type AgentDefinition, useAgentsStore } from '../../stores/agents.store'
import { type SkillDefinition, useSkillsStore } from '../../stores/skills.store'
import {
  pickStrictIntentHints,
  resolveStrictIntentKeywordsFromConfig
} from '../../../shared/skill-creation-config'
import type { ResourceType } from './types'

interface ResourceDraft {
  name: string
  description: string
  content: string
}

type CreationMode = 'quick' | 'strict'
type StrictSkillStage =
  | 'goal-confirmed'
  | 'eval-set-confirmed'
  | 'running'
  | 'review-ready'
  | 'feedback-collected'
  | 'finalized'
  | 'failed'

interface StrictFlowState {
  runId: string
  stage: StrictSkillStage
  progress: number
  iteration: number
  reviewHtmlPath: string | null
  benchmarkPath: string | null
  lastError: string | null
}

interface ResourceCreateModalProps {
  resourceType: ResourceType
  onClose: () => void
  onCreated?: (resource: SkillDefinition | AgentDefinition) => void
}

function isValidDraft(payload: unknown): payload is ResourceDraft {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  return (
    typeof candidate.name === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.content === 'string'
  )
}

function isStrictFlowState(payload: unknown): payload is StrictFlowState {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  return (
    typeof candidate.runId === 'string'
    && typeof candidate.stage === 'string'
    && typeof candidate.progress === 'number'
    && typeof candidate.iteration === 'number'
  )
}

function extractStrictFlowState(payload: unknown): StrictFlowState | null {
  if (isStrictFlowState(payload)) return payload
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Record<string, unknown>
  return isStrictFlowState(candidate.state) ? candidate.state : null
}

export function ResourceCreateModal({
  resourceType,
  onClose,
  onCreated
}: ResourceCreateModalProps): JSX.Element {
  const { t } = useTranslation()
  const [description, setDescription] = useState('')
  const [creationMode, setCreationMode] = useState<CreationMode>('quick')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [strictFlowState, setStrictFlowState] = useState<StrictFlowState | null>(null)
  const [strictFeedback, setStrictFeedback] = useState('')

  const createSkillInLibrary = useSkillsStore((state) => state.createSkillInLibrary)
  const createAgentInLibrary = useAgentsStore((state) => state.createAgentInLibrary)
  const appConfig = useAppStore((state) => state.config)
  const icon = resourceType === 'skill' ? Zap : Bot
  const title = resourceType === 'skill' ? t('Create Skill') : t('Create Agent')
  const placeholder = resourceType === 'skill'
    ? t('For example: a skill that reviews code and outputs a prioritized issue list')
    : t('For example: an agent focused on product strategy and requirement breakdown')
  const createLabel = resourceType === 'skill' ? t('Create Skill') : t('Create Agent')
  const Icon = icon

  const strictIntentKeywords = useMemo(
    () => resolveStrictIntentKeywordsFromConfig(appConfig),
    [appConfig]
  )
  const strictIntentHints = useMemo(
    () => pickStrictIntentHints(description, strictIntentKeywords),
    [description, strictIntentKeywords]
  )
  const shouldRecommendStrict = resourceType === 'skill' && creationMode === 'quick' && strictIntentHints.length > 0
  const isStrictMode = resourceType === 'skill' && creationMode === 'strict'
  const strictStageLabel = useMemo(() => {
    if (!strictFlowState) return ''
    switch (strictFlowState.stage) {
      case 'goal-confirmed':
        return t('Strict stage: goal confirmed')
      case 'eval-set-confirmed':
        return t('Strict stage: eval set confirmed')
      case 'running':
        return t('Strict stage: running')
      case 'review-ready':
        return t('Strict stage: review ready')
      case 'feedback-collected':
        return t('Strict stage: feedback collected')
      case 'finalized':
        return t('Strict stage: finalized')
      case 'failed':
        return t('Strict stage: failed')
      default:
        return strictFlowState.stage
    }
  }, [strictFlowState, t])
  const canGenerate = description.trim().length > 0 && !isGenerating
  const canCreate = hasDraft && name.trim().length > 0 && content.trim().length > 0 && !isCreating

  const handleStrictStart = async (prompt: string): Promise<void> => {
    const draftResponse = await api.generateSkillDraft({
      description: prompt,
      mode: 'strict',
      strictIntentHints
    })
    if (!draftResponse.success || !isValidDraft(draftResponse.data)) {
      setError(draftResponse.error || t('Failed to generate draft'))
      return
    }

    setName(draftResponse.data.name)
    setContent(draftResponse.data.content)
    setHasDraft(true)

    const strictRunResponse = await api.runStrictSkillFlow({
      action: 'start',
      description: prompt,
      strictIntentHints
    })
    const strictState = extractStrictFlowState(strictRunResponse.data)
    if (!strictRunResponse.success || !strictState) {
      setError(strictRunResponse.error || t('Failed to start strict mode run'))
      return
    }
    setStrictFlowState(strictState)
    setError(strictState.lastError || null)
  }

  const handleGenerate = async (): Promise<void> => {
    const prompt = description.trim()
    if (!prompt || isGenerating) return

    setError(null)
    setIsGenerating(true)
    try {
      if (isStrictMode) {
        await handleStrictStart(prompt)
        return
      }

      const response = resourceType === 'skill'
        ? await api.generateSkillDraft({ description: prompt, mode: 'quick', strictIntentHints })
        : await api.generateAgentDraft(prompt)
      if (!response.success || !isValidDraft(response.data)) {
        setHasDraft(false)
        setError(response.error || t('Failed to generate draft'))
        return
      }
      setName(response.data.name)
      setContent(response.data.content)
      setHasDraft(true)
    } catch (generateError) {
      console.error('[ResourceCreateModal] Failed to generate draft:', generateError)
      setHasDraft(false)
      setError(t('Failed to generate draft'))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleStrictContinue = async (): Promise<void> => {
    if (!strictFlowState) return
    setError(null)
    setIsGenerating(true)
    try {
      const response = await api.runStrictSkillFlow({
        action: 'continue',
        runId: strictFlowState.runId
      })
      const strictState = extractStrictFlowState(response.data)
      if (!response.success || !strictState) {
        setError(response.error || t('Failed to continue strict mode run'))
        return
      }
      setStrictFlowState(strictState)
      setError(strictState.lastError || null)
    } catch (strictError) {
      console.error('[ResourceCreateModal] Failed to continue strict run:', strictError)
      setError(t('Failed to continue strict mode run'))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleStrictFeedbackSubmit = async (): Promise<void> => {
    if (!strictFlowState) return
    const feedback = strictFeedback.trim()
    if (!feedback) return

    setError(null)
    setIsGenerating(true)
    try {
      const response = await api.runStrictSkillFlow({
        action: 'submit-feedback',
        runId: strictFlowState.runId,
        feedback
      })
      const strictState = extractStrictFlowState(response.data)
      if (!response.success || !strictState) {
        setError(response.error || t('Failed to submit strict mode feedback'))
        return
      }
      setStrictFlowState(strictState)
      setError(strictState.lastError || null)
    } catch (strictError) {
      console.error('[ResourceCreateModal] Failed to submit strict feedback:', strictError)
      setError(t('Failed to submit strict mode feedback'))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleStrictFinalize = async (): Promise<void> => {
    if (!strictFlowState || isCreating) return

    setError(null)
    setIsCreating(true)
    try {
      const response = await api.runStrictSkillFlow({
        action: 'finalize',
        runId: strictFlowState.runId,
        name: name.trim(),
        content
      })
      const strictState = extractStrictFlowState(response.data)
      if (!response.success || !strictState) {
        setError(response.error || t('Failed to create resource'))
        return
      }

      const createdPayload = response.data as { createdSkill?: SkillDefinition }
      const createdSkill = createdPayload.createdSkill
      if (!createdSkill) {
        setError(t('Failed to create resource'))
        return
      }
      setStrictFlowState(strictState)
      onCreated?.(createdSkill)
      onClose()
    } catch (createError) {
      console.error('[ResourceCreateModal] Failed to finalize strict skill run:', createError)
      setError(t('Failed to create resource'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (isStrictMode) {
      await handleStrictFinalize()
      return
    }
    if (!canCreate) return

    setError(null)
    setIsCreating(true)
    try {
      const created = resourceType === 'skill'
        ? await createSkillInLibrary(name.trim(), content)
        : await createAgentInLibrary(name.trim(), content)
      if (!created) {
        setError(t('Failed to create resource'))
        return
      }
      onCreated?.(created)
      onClose()
    } catch (createError) {
      console.error('[ResourceCreateModal] Failed to create resource:', createError)
      setError(t('Failed to create resource'))
    } finally {
      setIsCreating(false)
    }
  }

  const subtitle = useMemo(() => (
    resourceType === 'skill'
      ? t('Generate a skill draft from natural language and save it to library')
      : t('Generate an agent draft from natural language and save it to library')
  ), [resourceType, t])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 glass-overlay animate-fade-in" onClick={onClose} />

      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 glass-dialog border border-border/50 shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('Describe what you want')}
            </label>
            {resourceType === 'skill' && (
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="resource-create-mode-quick"
                  onClick={() => {
                    setCreationMode('quick')
                    setStrictFlowState(null)
                    setStrictFeedback('')
                    setError(null)
                  }}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${creationMode === 'quick'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {t('Quick mode')}
                </button>
                <button
                  type="button"
                  data-testid="resource-create-mode-strict"
                  onClick={() => {
                    setCreationMode('strict')
                    setError(null)
                  }}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${creationMode === 'strict'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {t('Strict mode')}
                </button>
              </div>
            )}
            <textarea
              data-testid="resource-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={placeholder}
              className="w-full min-h-[120px] px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:border-primary text-sm"
            />
            {shouldRecommendStrict && (
              <div
                data-testid="resource-create-strict-recommendation"
                className="mt-2 p-3 rounded-lg border border-primary/30 bg-primary/5 text-xs text-foreground"
              >
                <div className="font-medium mb-1">{t('Recommended: strict mode')}</div>
                <div className="text-muted-foreground mb-2">
                  {t('Detected evaluation/review intent. Strict mode can run benchmark and review workflow.')}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreationMode('strict')
                    setError(null)
                  }}
                  className="px-2.5 py-1 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                >
                  {t('Switch to strict')}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end">
            <button
              data-testid="resource-create-generate"
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              <span>{isGenerating ? t('Loading...') : t('Generate draft')}</span>
            </button>
          </div>

          {isStrictMode && strictFlowState && (
            <div data-testid="resource-create-strict-panel" className="space-y-3 p-4 rounded-xl border border-border/60 bg-secondary/20">
              <div className="text-sm font-medium text-foreground">
                {t('Strict flow status')}: {strictStageLabel} · {strictFlowState.progress}%
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, strictFlowState.progress))}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {t('Iteration')}: {strictFlowState.iteration}
              </div>

              {strictFlowState.reviewHtmlPath && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="resource-create-open-review"
                    onClick={() => void api.openExternal(`file://${strictFlowState.reviewHtmlPath}`)}
                    className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted transition-colors"
                  >
                    {t('Open review viewer')}
                  </button>
                  <span className="text-xs text-muted-foreground truncate">{strictFlowState.reviewHtmlPath}</span>
                </div>
              )}

              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('Iteration feedback')}</label>
                <textarea
                  data-testid="resource-create-strict-feedback"
                  value={strictFeedback}
                  onChange={(event) => setStrictFeedback(event.target.value)}
                  placeholder={t('Describe what should be improved in next iteration')}
                  className="w-full min-h-[96px] px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:border-primary text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="resource-create-strict-feedback-submit"
                  onClick={() => void handleStrictFeedbackSubmit()}
                  disabled={strictFeedback.trim().length === 0 || isGenerating}
                  className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('Submit feedback')}
                </button>
                <button
                  type="button"
                  data-testid="resource-create-strict-continue"
                  onClick={() => void handleStrictContinue()}
                  disabled={isGenerating}
                  className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('Run next iteration')}
                </button>
                <button
                  type="button"
                  data-testid="resource-create-strict-fallback"
                  onClick={() => {
                    setCreationMode('quick')
                    setStrictFlowState(null)
                    setStrictFeedback('')
                    setError(null)
                  }}
                  className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted transition-colors"
                >
                  {t('Back to quick mode')}
                </button>
              </div>
            </div>
          )}

          {hasDraft && (
            <div className="space-y-3 p-4 rounded-xl border border-border/60 bg-secondary/20">
              <div className="text-sm font-medium text-foreground inline-flex items-center gap-2">
                <Wand2 size={15} className="text-primary" />
                {t('Draft preview')}
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('Name')}</label>
                <input
                  data-testid="resource-create-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:border-primary text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('Content')}</label>
                <textarea
                  data-testid="resource-create-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="w-full min-h-[260px] px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:border-primary text-sm font-mono"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border/50 bg-muted/30 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            data-testid="resource-create-submit"
            type="button"
            onClick={() => void handleCreate()}
            disabled={isStrictMode ? (!hasDraft || !strictFlowState || isCreating) : !canCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Zap size={16} />
            )}
            <span>{isCreating ? t('Loading...') : createLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
