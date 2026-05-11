import type { Message } from '../types'

export interface MessageMarkdownExportInput {
  title: string
  userMessage?: Message
  assistantMessage: Message
}

export interface MessageMarkdownFileNameInput {
  title: string
  messageId: string
  now?: Date
}

export interface MessageMarkdownFallbackTitleInput {
  assistantContent: string
  widgetTitles?: string[]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTimestamp(now: Date): string {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
}

function trimMessageContent(content?: string): string {
  return (content || '').trim()
}

export function sanitizeMarkdownExportTitle(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[#\s"'“”‘’`*_~.-]+|[\s"'“”‘’`*_~.-]+$/g, '')
    .replace(/\s*\.md$/i, '')
    .trim()

  return cleaned || '对话导出'
}

function sanitizeFilePart(value: string): string {
  const cleaned = sanitizeMarkdownExportTitle(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return cleaned || 'conversation-export'
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]+/g, '')
}

export function buildMessageMarkdownFallbackTitle({
  assistantContent,
  widgetTitles = []
}: MessageMarkdownFallbackTitleInput): string {
  const h1Match = assistantContent.match(/^#\s+(.+)$/m)
  if (h1Match?.[1]?.trim()) {
    return sanitizeMarkdownExportTitle(stripInlineMarkdown(h1Match[1]))
  }

  const widgetTitle = widgetTitles.find((title) => title.trim().length > 0)
  if (widgetTitle) {
    return sanitizeMarkdownExportTitle(widgetTitle)
  }

  return '对话导出'
}

export function buildMessageMarkdownExport({
  title,
  userMessage,
  assistantMessage
}: MessageMarkdownExportInput): string {
  const normalizedTitle = sanitizeMarkdownExportTitle(title)
  const userContent = trimMessageContent(userMessage?.content)
  const assistantContent = trimMessageContent(assistantMessage.content)
  const parts = [`# ${normalizedTitle}`, '']

  if (userContent) {
    parts.push('## 提问', '', userContent, '')
  }

  parts.push('## 回答', '', assistantContent, '')

  return parts.join('\n')
}

export function buildMessageMarkdownFileName({
  title,
  messageId,
  now = new Date()
}: MessageMarkdownFileNameInput): string {
  return `${sanitizeFilePart(title)}-${formatTimestamp(now)}-${sanitizeFilePart(messageId)}.md`
}
