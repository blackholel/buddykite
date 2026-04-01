import { useMemo, useState } from 'react'
import { Bot, Sparkles, Wand2, X, Zap } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { type AgentDefinition, useAgentsStore } from '../../stores/agents.store'
import { type SkillDefinition, useSkillsStore } from '../../stores/skills.store'
import type { ResourceType } from './types'

interface ResourceDraft {
  name: string
  description: string
  content: string
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

export function ResourceCreateModal({
  resourceType,
  onClose,
  onCreated
}: ResourceCreateModalProps): JSX.Element {
  const { t } = useTranslation()
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)

  const createSkillInLibrary = useSkillsStore((state) => state.createSkillInLibrary)
  const createAgentInLibrary = useAgentsStore((state) => state.createAgentInLibrary)
  const icon = resourceType === 'skill' ? Zap : Bot
  const title = resourceType === 'skill' ? t('Create Skill') : t('Create Agent')
  const placeholder = resourceType === 'skill'
    ? t('For example: a skill that reviews code and outputs a prioritized issue list')
    : t('For example: an agent focused on product strategy and requirement breakdown')
  const createLabel = resourceType === 'skill' ? t('Create Skill') : t('Create Agent')
  const Icon = icon

  const canGenerate = description.trim().length > 0 && !isGenerating
  const canCreate = hasDraft && name.trim().length > 0 && content.trim().length > 0 && !isCreating

  const handleGenerate = async (): Promise<void> => {
    const prompt = description.trim()
    if (!prompt || isGenerating) return

    setError(null)
    setIsGenerating(true)
    try {
      const response = resourceType === 'skill'
        ? await api.generateSkillDraft({ description: prompt })
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

  const handleCreate = async (): Promise<void> => {
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
            <textarea
              data-testid="resource-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={placeholder}
              className="w-full min-h-[120px] px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:border-primary text-sm"
            />
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
            disabled={!canCreate}
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
