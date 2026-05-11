/**
 * MessageItem - Single message display with enhanced streaming visualization
 * Includes collapsible thought process for assistant messages
 *
 * Working State Design:
 * - During generation: subtle breathing glow + "AI working" indicator
 * - The indicator is gentle, not intrusive, letting user focus on content
 * - When complete: indicator fades out smoothly
 */

import { useState, useCallback, useMemo, memo } from 'react'
import {
  Sparkles,
  Copy,
  Check,
  Bot,
  Zap,
  FilePlus2,
  FileText
} from 'lucide-react'
import { join } from 'path-browserify'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MessageImages } from './ImageAttachmentPreview'
import { PlanCard } from './PlanCard'
import { WidgetRenderer } from './WidgetRenderer'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'
import { FileIcon } from '../icons/ToolIcons'
import type { Message } from '../../types'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import { useCanvasStore } from '../../stores/canvas.store'
import {
  parseComposerMessageForDisplay,
  type ComposerResourceDisplayLookups
} from '../../utils/composer-resource-chip'
import { parseAllShowWidgets } from '../../lib/widget-sanitizer'
import {
  buildWidgetMarkdownExport,
  buildWidgetMarkdownFileName
} from '../../lib/widget-markdown-export'
import {
  buildMessageMarkdownExport,
  buildMessageMarkdownFallbackTitle,
  buildMessageMarkdownFileName
} from '../../lib/message-markdown-export'
export { parseAllShowWidgets, computePartialWidgetKey } from '../../lib/widget-sanitizer'

interface MessageItemProps {
  message: Message
  previousUserMessage?: Message
  previousCost?: number  // Previous message's cumulative cost
  hideThoughts?: boolean
  isInContainer?: boolean
  isWorking?: boolean  // True when AI is still generating (not yet complete)
  isWaitingMore?: boolean  // True when content paused (e.g., during tool call), show "..." animation
  spaceId?: string | null
  workDir?: string  // For skill suggestion card creation
  resourceDisplayLookups?: ComposerResourceDisplayLookups
  onOpenPlanInCanvas?: (planContent: string) => void
  onExecutePlan?: (planContent: string) => void
}

const EMPTY_RESOURCE_DISPLAY_LOOKUPS: ComposerResourceDisplayLookups = {
  skills: new Map(),
  agents: new Map()
}

export const MessageItem = memo(function MessageItem({
  message,
  previousUserMessage,
  previousCost = 0,
  isInContainer = false,
  isWorking = false,
  isWaitingMore = false,
  spaceId = null,
  workDir,
  resourceDisplayLookups,
  onOpenPlanInCanvas,
  onExecutePlan
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const isStreaming = (message as any).isStreaming
  const [copied, setCopied] = useState(false)
  const [savingWidgetKey, setSavingWidgetKey] = useState<string | null>(null)
  const [savingMessage, setSavingMessage] = useState(false)
  const { t } = useTranslation()
  const openFile = useCanvasStore(state => state.openFile)
  const userFileContexts = isUser ? (message.fileContexts || []) : []
  const parsedUserMessage = useMemo(() => {
    if (!isUser || !message.content) return null
    return parseComposerMessageForDisplay(
      message.content,
      resourceDisplayLookups || EMPTY_RESOURCE_DISPLAY_LOOKUPS
    )
  }, [isUser, message.content, resourceDisplayLookups])
  const parsedAssistantSegments = useMemo(() => {
    if (isUser || !message.content || message.isPlan) return []
    return parseAllShowWidgets(message.content)
  }, [isUser, message.content, message.isPlan])
  const hasWidgetSegments = useMemo(
    () => parsedAssistantSegments.some((segment) => segment.type === 'widget'),
    [parsedAssistantSegments]
  )
  const widgetTitles = useMemo(() => {
    return parsedAssistantSegments
      .filter((segment): segment is Extract<(typeof parsedAssistantSegments)[number], { type: 'widget' }> => segment.type === 'widget')
      .map((segment) => segment.title)
      .filter((title): title is string => Boolean(title?.trim()))
  }, [parsedAssistantSegments])
  const assistantTextForTitle = useMemo(() => {
    const textSegments = parsedAssistantSegments
      .filter((segment): segment is Extract<(typeof parsedAssistantSegments)[number], { type: 'text' }> => segment.type === 'text')
      .map((segment) => segment.content.trim())
      .filter(Boolean)

    if (textSegments.length > 0) return textSegments.join('\n\n')
    return hasWidgetSegments ? '' : message.content
  }, [hasWidgetSegments, message.content, parsedAssistantSegments])
  const canSaveWidget = !isStreaming && Boolean(spaceId && workDir)
  const canSaveMessage = !isUser && !message.isPlan && !isStreaming && Boolean(spaceId && workDir && message.content.trim())

  // Handle copying message content to clipboard
  const handleCopyMessage = useCallback(async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy message:', err)
    }
  }, [message.content])

  const handleSaveWidget = useCallback(async (segment: Extract<(typeof parsedAssistantSegments)[number], { type: 'widget' }>) => {
    if (!spaceId || !workDir) return

    const name = buildWidgetMarkdownFileName({
      messageId: message.id,
      segmentKey: segment.key
    })
    const parentPath = join(workDir, 'widgets')
    const content = buildWidgetMarkdownExport({
      title: segment.title,
      widgetCode: segment.widgetCode
    })

    setSavingWidgetKey(segment.key)
    try {
      const result = await api.createArtifactEntry<{ path: string }>({
        type: 'file',
        parentPath,
        name,
        content
      })
      if (!result.success || !result.data?.path) {
        throw new Error(result.error || 'Failed to save widget')
      }
      window.dispatchEvent(new CustomEvent('artifacts:refresh', { detail: { spaceId } }))
      await openFile(spaceId, result.data.path, name)
    } catch (error) {
      console.error('[MessageItem] Failed to save widget markdown:', error)
      window.alert(t('Failed to create file'))
    } finally {
      setSavingWidgetKey(null)
    }
  }, [message.id, openFile, spaceId, t, workDir])

  const handleSaveMessage = useCallback(async () => {
    if (!spaceId || !workDir || !message.content.trim()) return

    const fallbackTitle = buildMessageMarkdownFallbackTitle({
      assistantContent: message.content,
      widgetTitles
    })

    setSavingMessage(true)
    try {
      const titleResponse = await api.generateMarkdownExportTitle<{
        title: string
        source: 'ai' | 'fallback'
        error?: string
      }>({
        userPrompt: previousUserMessage?.content,
        assistantText: assistantTextForTitle,
        widgetTitles,
        fallbackTitle
      })
      const title = titleResponse.success && titleResponse.data?.title
        ? titleResponse.data.title
        : fallbackTitle
      const name = buildMessageMarkdownFileName({
        title,
        messageId: message.id
      })
      const content = buildMessageMarkdownExport({
        title,
        userMessage: previousUserMessage,
        assistantMessage: message
      })

      const result = await api.createArtifactEntry<{ path: string }>({
        type: 'file',
        parentPath: join(workDir, 'exports'),
        name,
        content
      })
      if (!result.success || !result.data?.path) {
        throw new Error(result.error || 'Failed to save message')
      }
      window.dispatchEvent(new CustomEvent('artifacts:refresh', { detail: { spaceId } }))
      await openFile(spaceId, result.data.path, name)
    } catch (error) {
      console.error('[MessageItem] Failed to save message markdown:', error)
      window.alert(t('Failed to create file'))
    } finally {
      setSavingMessage(false)
    }
  }, [
    assistantTextForTitle,
    message,
    openFile,
    previousUserMessage,
    spaceId,
    t,
    widgetTitles,
    workDir
  ])

  // Message bubble content
  const widthClass = isUser
    ? (isInContainer ? 'w-full' : 'max-w-[85%]')
    : 'w-full'

  const bubbleClasses = [
    isUser
      ? 'space-studio-message-bubble rounded-2xl px-4 py-3.5 overflow-hidden'
      : 'space-studio-message-flat',
    'transition-all duration-300',
    isUser ? 'message-user' : 'message-assistant',
    isUser ? 'space-studio-message-user' : 'space-studio-message-assistant',
    isStreaming && 'streaming-message',
    isWorking && 'message-working',
    widthClass,
  ].filter(Boolean).join(' ')

  const contentClasses = [
    'break-words',
    isUser ? 'leading-relaxed' : 'space-studio-assistant-content'
  ].join(' ')
  const showAssistantFooter = !isUser && !isWorking && Boolean(message.content)

  const bubble = (
    <div className={bubbleClasses}>
      {/* Working indicator - shows when AI is working */}
      {isWorking && !isUser && (
        <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-border/20 working-indicator-fade">
          <Sparkles size={12} className="text-foreground/60 animate-pulse-gentle" />
          <span className="text-[11px] text-muted-foreground/60 font-medium tracking-wide">{t('Kite is working')}</span>
        </div>
      )}

      {/* User message images (displayed before text) */}
      {isUser && message.images && message.images.length > 0 && (
        <MessageImages images={message.images} />
      )}

      {/* User file contexts (read-only chips, shown after send for context awareness) */}
      {userFileContexts.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {userFileContexts.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-1.5 pl-2 pr-2 py-1 bg-secondary/50 rounded-lg border border-border/50 text-xs"
              title={file.path}
            >
              <FileIcon extension={file.extension} size={14} />
              <span className="max-w-[180px] truncate text-foreground/80">{file.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Message content with streaming cursor */}
      <div className={contentClasses} data-message-content>
        {message.content && (
          isUser ? (
            <>
              {parsedUserMessage && parsedUserMessage.chips.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {parsedUserMessage.chips.map((chip) => {
                    const Icon = chip.type === 'agent' ? Bot : Zap
                    return (
                      <span
                        key={chip.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2 py-1 text-sm text-foreground"
                      >
                        <Icon size={14} />
                        <span className="font-medium">{chip.displayName}</span>
                      </span>
                    )
                  })}
                </div>
              )}
              {(parsedUserMessage?.text ?? message.content) && (
                <span className="whitespace-pre-wrap">{parsedUserMessage?.text ?? message.content}</span>
              )}
            </>
          ) : message.isPlan ? (
            // Plan mode: structured plan card
            <PlanCard
              content={message.content}
              onOpenInCanvas={onOpenPlanInCanvas}
              onExecutePlan={onExecutePlan}
              workDir={workDir}
            />
          ) : (
            hasWidgetSegments ? (
              // Assistant messages: render text + show-widget segments in order
              <div className="space-y-3">
                {parsedAssistantSegments.map((segment) => {
                  if (segment.type === 'text') {
                    if (!segment.content) return null
                    return (
                      <MarkdownRenderer
                        key={segment.key}
                        content={segment.content}
                        workDir={workDir}
                        headingIdPrefix={`msg-${message.id}-${segment.key}`}
                        className="space-studio-assistant-markdown"
                      />
                    )
                  }

                  return (
                    <div key={segment.key} className="group/widget-save relative">
                      {canSaveWidget && (
                        <button
                          type="button"
                          onClick={() => handleSaveWidget(segment)}
                          disabled={savingWidgetKey === segment.key}
                          className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/50 bg-background/75 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition hover:bg-background hover:text-foreground group-hover/widget-save:opacity-100 disabled:opacity-50"
                          title={t('Save chart as Markdown')}
                          aria-label={t('Save chart as Markdown')}
                          data-testid="save-widget-markdown"
                        >
                          {savingWidgetKey === segment.key ? (
                            <Check size={14} className="text-kite-success" />
                          ) : (
                            <FilePlus2 size={14} />
                          )}
                        </button>
                      )}
                      <WidgetErrorBoundary
                        fallbackTitle={t('Widget failed to render')}
                        fallbackDetail={t('Widget render error')}
                      >
                        <WidgetRenderer
                          widgetKey={segment.key}
                          title={segment.title}
                          widgetCode={segment.widgetCode}
                          isPartial={false}
                        />
                      </WidgetErrorBoundary>
                    </div>
                  )
                })}
              </div>
            ) : (
              // Assistant messages: full markdown rendering
              <MarkdownRenderer
                content={message.content}
                workDir={workDir}
                headingIdPrefix={`msg-${message.id}`}
                className="space-studio-assistant-markdown"
              />
            )
          )
        )}
        {/* Streaming cursor when actively receiving tokens */}
        {isStreaming && (
          <span className="inline-block w-0.5 h-5 ml-0.5 bg-foreground/70 streaming-cursor align-middle" />
        )}
        {/* Waiting dots when content paused but still working (e.g., tool call in progress) */}
        {isWaitingMore && !isStreaming && (
          <span className="waiting-dots ml-1 text-muted-foreground/60" />
        )}
      </div>

      {/* Assistant footer: action row under body */}
      {showAssistantFooter && (
        <div className="space-studio-assistant-footer mt-4 pt-2.5">
          <button
            onClick={handleCopyMessage}
            className="space-studio-assistant-footer-action"
            title={t('Copy message')}
            aria-label={t('Copy message')}
          >
            {copied ? (
              <>
                <Check size={13} className="text-kite-success" />
                <span className="text-kite-success">{t('Copied')}</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>{t('Copy')}</span>
              </>
            )}
          </button>
          {canSaveMessage && (
            <button
              onClick={handleSaveMessage}
              disabled={savingMessage}
              className="space-studio-assistant-footer-action"
              title={t('Save reply as Markdown')}
              aria-label={t('Save reply as Markdown')}
              data-testid="save-message-markdown"
            >
              {savingMessage ? (
                <>
                  <Check size={13} className="text-kite-success" />
                  <span className="text-kite-success">{t('Saving')}</span>
                </>
              ) : (
                <>
                  <FileText size={13} />
                  <span>{t('Save reply')}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )

  // When in container, just return the bubble without wrapper
  if (isInContainer) {
    // Even in container, we need data-message-id for search navigation
    return (
      <div
        data-message-id={message.id}
        data-message-role={message.role}
        style={{ contentVisibility: 'auto', containIntrinsicSize: '180px' }}
      >
        {bubble}
      </div>
    )
  }

  // Normal case: wrap with flex container
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
      data-message-id={message.id}
      data-message-role={message.role}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '180px' }}
    >
      {bubble}
    </div>
  )
}, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.previousUserMessage === next.previousUserMessage &&
    prev.previousCost === next.previousCost &&
    prev.hideThoughts === next.hideThoughts &&
    prev.isInContainer === next.isInContainer &&
    prev.isWorking === next.isWorking &&
    prev.isWaitingMore === next.isWaitingMore &&
    prev.spaceId === next.spaceId &&
    prev.workDir === next.workDir &&
    prev.resourceDisplayLookups === next.resourceDisplayLookups &&
    prev.onOpenPlanInCanvas === next.onOpenPlanInCanvas &&
    prev.onExecutePlan === next.onExecutePlan
  )
})
