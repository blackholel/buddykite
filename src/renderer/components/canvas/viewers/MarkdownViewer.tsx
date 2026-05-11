/**
 * Markdown Viewer - Rendered markdown with source toggle
 *
 * Features:
 * - Beautiful markdown rendering
 * - Toggle between rendered and source view
 * - Direct editing in preview mode
 * - Monaco markdown source editing
 * - Copy to clipboard
 * - Window maximize for fullscreen viewing
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Copy, Check, Code, Eye, ExternalLink, Save } from 'lucide-react'
import Editor, { type OnChange, type OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { dirname } from 'path-browserify'
import { api } from '../../../api'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useTranslation } from '../../../i18n'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'

loader.config({ monaco })

interface MarkdownViewerProps {
  tab: CanvasTab
  onScrollChange?: (position: number) => void
  onContentChange?: (content: string) => void
  onSave?: () => void
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ')
}

function serializeInlineNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeText(node.textContent || '')
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()

  if (tag === 'br') return '\n'
  if (tag === 'button' || tag === 'svg' || tag === 'path' || tag === 'style' || tag === 'script' || tag === 'input') {
    return ''
  }

  const inner = serializeInlineNodes(Array.from(element.childNodes))

  if (tag === 'strong' || tag === 'b') return inner ? `**${inner}**` : ''
  if (tag === 'em' || tag === 'i') return inner ? `*${inner}*` : ''
  if (tag === 'del') return inner ? `~~${inner}~~` : ''
  if (tag === 'code' && element.parentElement?.tagName.toLowerCase() !== 'pre') return inner ? `\`${inner}\`` : ''
  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (href) {
      const label = inner.trim() || href
      return `[${label}](${href})`
    }
    return inner
  }
  if (tag === 'img') {
    const alt = element.getAttribute('alt') || ''
    const src = element.getAttribute('src') || ''
    return src ? `![${alt}](${src})` : ''
  }

  return inner
}

function serializeInlineNodes(nodes: ChildNode[]): string {
  return nodes.map((node) => serializeInlineNode(node)).join('')
}

function serializeList(element: HTMLElement, ordered: boolean): string {
  const lines: string[] = []
  let index = 1

  for (const child of Array.from(element.children)) {
    if (child.tagName.toLowerCase() !== 'li') continue
    const li = child as HTMLElement
    const marker = ordered ? `${index}.` : '-'
    const nonNestedNodes = Array.from(li.childNodes).filter((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return true
      const tag = (node as HTMLElement).tagName.toLowerCase()
      return tag !== 'ul' && tag !== 'ol'
    })

    const itemText = serializeInlineNodes(nonNestedNodes).trim()
    lines.push(itemText ? `${marker} ${itemText}` : `${marker}`)

    for (const nested of Array.from(li.children)) {
      const nestedTag = nested.tagName.toLowerCase()
      if (nestedTag !== 'ul' && nestedTag !== 'ol') continue
      const nestedMarkdown = serializeList(nested as HTMLElement, nestedTag === 'ol').trimEnd()
      if (nestedMarkdown) {
        lines.push(...nestedMarkdown.split('\n').map((line) => (line ? `  ${line}` : line)))
      }
    }

    index += 1
  }

  return lines.length > 0 ? `${lines.join('\n')}\n\n` : ''
}

function serializeBlockNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeText(node.textContent || '').trim()
    return text ? `${text}\n\n` : ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()

  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    const level = Number.parseInt(tag[1] || '1', 10)
    const text = serializeInlineNodes(Array.from(element.childNodes)).trim()
    return text ? `${'#'.repeat(level)} ${text}\n\n` : ''
  }

  if (tag === 'p') {
    const text = serializeInlineNodes(Array.from(element.childNodes)).trim()
    return text ? `${text}\n\n` : ''
  }

  if (tag === 'pre') {
    const code = element.querySelector('code')
    const raw = normalizeText((code?.textContent || element.textContent || '').replace(/\n+$/, ''))
    if (!raw) return ''
    const languageClass = code?.className
      ?.split(/\s+/)
      .find((value) => value.startsWith('language-'))
    const language = languageClass ? languageClass.replace('language-', '') : ''
    return `\`\`\`${language}\n${raw}\n\`\`\`\n\n`
  }

  if (tag === 'blockquote') {
    const body = Array.from(element.childNodes).map((child) => serializeBlockNode(child)).join('').trimEnd()
    if (!body) return ''
    const quoted = body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')
    return `${quoted}\n\n`
  }

  if (tag === 'ul') return serializeList(element, false)
  if (tag === 'ol') return serializeList(element, true)
  if (tag === 'hr') return '---\n\n'

  if (tag === 'div') {
    const blockLikeChildren = Array.from(element.children).some((child) => {
      const childTag = child.tagName.toLowerCase()
      return childTag === 'div' || childTag === 'p' || childTag.startsWith('h') || childTag === 'ul' || childTag === 'ol' || childTag === 'pre' || childTag === 'blockquote'
    })
    if (blockLikeChildren) {
      return Array.from(element.childNodes).map((child) => serializeBlockNode(child)).join('')
    }
    const text = serializeInlineNodes(Array.from(element.childNodes)).trim()
    return text ? `${text}\n\n` : ''
  }

  const text = serializeInlineNodes(Array.from(element.childNodes)).trim()
  return text ? `${text}\n\n` : ''
}

function serializeEditableMarkdown(root: HTMLElement): string {
  const blocks = Array.from(root.childNodes).map((node) => serializeBlockNode(node)).join('')
  const normalized = blocks
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return normalized
}

export function MarkdownViewer({ tab, onScrollChange, onContentChange, onSave }: MarkdownViewerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const previewEditableRef = useRef<HTMLDivElement>(null)
  const sourceEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const sourceScrollDisposableRef = useRef<monaco.IDisposable | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const pendingDraftRef = useRef<string | null>(null)
  const previewDraftRef = useRef(tab.content || '')
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
  const [isPreviewEditing, setIsPreviewEditing] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    document.documentElement.classList.contains('dark')
  )
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draftContent, setDraftContent] = useState(tab.content || '')

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const flushDraft = useCallback((nextContent: string) => {
    if (onContentChange) {
      onContentChange(nextContent)
    }
    pendingDraftRef.current = null
  }, [onContentChange])

  const flushPendingDraft = useCallback(() => {
    clearFlushTimer()
    if (pendingDraftRef.current != null) {
      flushDraft(pendingDraftRef.current)
    }
  }, [clearFlushTimer, flushDraft])

  const scheduleFlushDraft = useCallback((nextContent: string) => {
    pendingDraftRef.current = nextContent
    clearFlushTimer()
    flushTimerRef.current = window.setTimeout(() => {
      flushDraft(nextContent)
    }, 200)
  }, [clearFlushTimer, flushDraft])

  useEffect(() => {
    setDraftContent(tab.content || '')
    previewDraftRef.current = tab.content || ''
    setIsPreviewEditing(false)
    pendingDraftRef.current = null
    clearFlushTimer()
  }, [tab.id, tab.content, clearFlushTimer])

  useEffect(() => {
    return () => {
      flushPendingDraft()
    }
  }, [flushPendingDraft])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkTheme(document.documentElement.classList.contains('dark'))
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      sourceScrollDisposableRef.current?.dispose()
      sourceScrollDisposableRef.current = null
      sourceEditorRef.current = null
    }
  }, [])

  // Restore scroll position
  useEffect(() => {
    if (tab.scrollPosition === undefined) return
    if (viewMode === 'source') {
      sourceEditorRef.current?.setScrollTop(tab.scrollPosition)
      return
    }
    if (containerRef.current) {
      containerRef.current.scrollTop = tab.scrollPosition
    }
  }, [tab.id, tab.scrollPosition, viewMode])

  // Save scroll position
  const handleScroll = useCallback(() => {
    if (containerRef.current && onScrollChange) {
      onScrollChange(containerRef.current.scrollTop)
    }
  }, [onScrollChange])

  const readPreviewDraft = useCallback(() => {
    if (!isPreviewEditing) return draftContent
    const editableContainer = previewEditableRef.current
    if (!editableContainer) return previewDraftRef.current
    const markdownRoot = editableContainer.querySelector('.markdown-content')
    const rootElement = markdownRoot instanceof HTMLElement ? markdownRoot : editableContainer
    const nextDraft = serializeEditableMarkdown(rootElement)
    previewDraftRef.current = nextDraft
    return nextDraft
  }, [draftContent, isPreviewEditing])

  const commitPreviewDraft = useCallback((scheduleFlush: boolean) => {
    const nextDraft = readPreviewDraft()
    if (nextDraft !== draftContent) {
      setDraftContent(nextDraft)
    }
    if (scheduleFlush) {
      scheduleFlushDraft(nextDraft)
    }
    return nextDraft
  }, [draftContent, readPreviewDraft, scheduleFlushDraft])

  // Copy content
  const handleCopy = async () => {
    const copyTarget = isPreviewEditing ? readPreviewDraft() : draftContent
    if (!copyTarget) return
    try {
      await navigator.clipboard.writeText(copyTarget)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleContentChange = useCallback((nextContent: string) => {
    setDraftContent(nextContent)
    previewDraftRef.current = nextContent
    scheduleFlushDraft(nextContent)
  }, [scheduleFlushDraft])

  const handlePreviewInput = useCallback(() => {
    const nextDraft = readPreviewDraft()
    scheduleFlushDraft(nextDraft)
  }, [readPreviewDraft, scheduleFlushDraft])

  const enterPreviewEditMode = useCallback(() => {
    if (viewMode !== 'rendered' || isPreviewEditing) return
    setIsPreviewEditing(true)
    requestAnimationFrame(() => {
      previewEditableRef.current?.focus()
    })
  }, [isPreviewEditing, viewMode])

  const handlePreviewClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (viewMode !== 'rendered' || isPreviewEditing) return
    const target = event.target as HTMLElement | null
    if (target?.closest('a, button, [data-md-file-chip="true"]')) {
      event.preventDefault()
      event.stopPropagation()
    }
    enterPreviewEditMode()
  }, [enterPreviewEditMode, isPreviewEditing, viewMode])

  const handlePreviewBlur = useCallback(() => {
    if (!isPreviewEditing) return
    commitPreviewDraft(true)
    setIsPreviewEditing(false)
  }, [commitPreviewDraft, isPreviewEditing])

  const handleSaveWithFeedback = useCallback(() => {
    if (isPreviewEditing) {
      commitPreviewDraft(true)
    }
    if (!onSave) return
    flushPendingDraft()
    onSave()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [commitPreviewDraft, flushPendingDraft, isPreviewEditing, onSave])

  const handleEditorMount: OnMount = useCallback((editor, monacoApi) => {
    sourceEditorRef.current = editor
    sourceScrollDisposableRef.current?.dispose()
    sourceScrollDisposableRef.current = editor.onDidScrollChange(() => {
      onScrollChange?.(editor.getScrollTop())
    })

    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      handleSaveWithFeedback()
    })

    // Stage 2 restore: mount-time fallback for async editor creation.
    editor.setScrollTop(tab.scrollPosition ?? 0)
    editor.focus()
  }, [handleSaveWithFeedback, onScrollChange, tab.scrollPosition])

  const handleEditorChange: OnChange = useCallback((value) => {
    if (value === undefined) return
    handleContentChange(value)
  }, [handleContentChange])

  const editorOptions = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
    fontSize: 13,
    lineNumbers: 'on',
    wordWrap: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    renderWhitespace: 'selection',
    padding: {
      top: 16,
      bottom: 16,
    },
  }), [])

  // Open with external application
  const handleOpenExternal = async () => {
    if (!tab.path) return
    try {
      await api.openArtifact(tab.path)
    } catch (err) {
      console.error('Failed to open with external app:', err)
    }
  }

  const content = draftContent
  const canOpenExternal = !api.isRemoteMode() && tab.path
  const markdownBasePath = tab.path ? dirname(tab.path) : tab.workDir

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md bg-secondary/50 p-0.5">
            <button
              onClick={() => {
                setViewMode('rendered')
              }}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                ${viewMode === 'rendered'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              <Eye className="w-3.5 h-3.5" />
              {t('Preview')}
            </button>
            <button
              onClick={() => {
                commitPreviewDraft(true)
                setIsPreviewEditing(false)
                setViewMode('source')
              }}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                ${viewMode === 'source'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              <Code className="w-3.5 h-3.5" />
              {t('Source')}
            </button>
          </div>
          {tab.isDirty && <span className="text-xs text-amber-500">{t('Modified')}</span>}
        </div>

        <div className="flex items-center gap-1">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-secondary transition-colors"
            title={t('Copy')}
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {/* Save button */}
          {onSave && (
            <button
              onClick={handleSaveWithFeedback}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Save (Cmd+S)')}
            >
              {saved ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Save className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}

          {/* Open with external app */}
          {canOpenExternal && (
            <button
              onClick={handleOpenExternal}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Open in external application')}
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 min-h-0 ${viewMode === 'source' ? 'overflow-hidden' : 'overflow-auto'}`}
      >
        {viewMode === 'rendered' ? (
          <div
            ref={previewEditableRef}
            contentEditable={isPreviewEditing}
            suppressContentEditableWarning={isPreviewEditing}
            onClick={handlePreviewClick}
            onInput={isPreviewEditing ? handlePreviewInput : undefined}
            onBlur={isPreviewEditing ? handlePreviewBlur : undefined}
            className={`h-full p-6 ${isPreviewEditing ? 'outline-none caret-foreground [&_button]:hidden' : 'cursor-text'}`}
          >
            <MarkdownRenderer content={content} basePath={markdownBasePath} />
          </div>
        ) : (
          <Editor
            height="100%"
            language="markdown"
            value={content}
            theme={isDarkTheme ? 'vs-dark' : 'vs'}
            onMount={handleEditorMount}
            onChange={handleEditorChange}
            options={editorOptions}
            loading={
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t('Loading editor...')}
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}
