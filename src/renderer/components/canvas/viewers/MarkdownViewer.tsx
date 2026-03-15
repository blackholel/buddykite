/**
 * Markdown Viewer - Rendered markdown with source toggle
 *
 * Features:
 * - Beautiful markdown rendering
 * - Toggle between rendered and source view
 * - Code block syntax highlighting
 * - Copy to clipboard
 * - Window maximize for fullscreen viewing
 */

import { useState, useRef, useCallback, useEffect, type RefObject } from 'react'
import { Copy, Check, Code, Eye, ExternalLink, Save } from 'lucide-react'
import { dirname } from 'path-browserify'
import { api } from '../../../api'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useTranslation } from '../../../i18n'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'

interface MarkdownViewerProps {
  tab: CanvasTab
  onScrollChange?: (position: number) => void
  onContentChange?: (content: string) => void
  onSave?: () => void
}

export function MarkdownViewer({ tab, onScrollChange, onContentChange, onSave }: MarkdownViewerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const sourceEditorRef = useRef<HTMLTextAreaElement>(null)
  const flushTimerRef = useRef<number | null>(null)
  const pendingDraftRef = useRef<string | null>(null)
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
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
    pendingDraftRef.current = null
    clearFlushTimer()
  }, [tab.id, tab.content, clearFlushTimer])

  useEffect(() => {
    return () => {
      flushPendingDraft()
    }
  }, [flushPendingDraft])

  // Restore scroll position
  useEffect(() => {
    if (tab.scrollPosition === undefined) return
    if (viewMode === 'source') {
      if (sourceEditorRef.current) {
        sourceEditorRef.current.scrollTop = tab.scrollPosition
      }
      return
    }
    if (containerRef.current) {
      containerRef.current.scrollTop = tab.scrollPosition
    }
  }, [tab.id, viewMode])

  // Save scroll position
  const handleScroll = useCallback(() => {
    if (containerRef.current && onScrollChange) {
      onScrollChange(containerRef.current.scrollTop)
    }
  }, [onScrollChange])

  // Copy content
  const handleCopy = async () => {
    if (!draftContent) return
    try {
      await navigator.clipboard.writeText(draftContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleContentChange = useCallback((nextContent: string) => {
    setDraftContent(nextContent)
    scheduleFlushDraft(nextContent)
  }, [scheduleFlushDraft])

  const handleSave = useCallback(() => {
    if (!onSave) return
    flushPendingDraft()
    onSave()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [flushPendingDraft, onSave])

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
    <div className="relative flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md bg-secondary/50 p-0.5">
            <button
              onClick={() => setViewMode('rendered')}
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
              onClick={() => setViewMode('source')}
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
              onClick={handleSave}
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
        className="flex-1 overflow-auto"
      >
        {viewMode === 'rendered' ? (
          <div className="p-6">
            <MarkdownRenderer content={content} basePath={markdownBasePath} />
          </div>
        ) : (
          <SourceEditor
            editorRef={sourceEditorRef}
            content={content}
            onContentChange={handleContentChange}
            onSave={handleSave}
            onScrollChange={onScrollChange}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Source editor for markdown with save shortcut
 */
function SourceEditor({
  editorRef,
  content,
  onContentChange,
  onSave,
  onScrollChange
}: {
  editorRef: RefObject<HTMLTextAreaElement>
  content: string
  onContentChange: (content: string) => void
  onSave?: () => void
  onScrollChange?: (position: number) => void
}) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave?.()
    }
  }, [onSave])

  return (
    <textarea
      ref={editorRef}
      value={content}
      onChange={(e) => onContentChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop)}
      spellCheck={false}
      className="w-full h-full resize-none bg-background text-foreground p-4 font-mono text-sm leading-6 outline-none"
    />
  )
}
