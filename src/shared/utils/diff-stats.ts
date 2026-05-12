import { diffLines } from 'diff'

export interface LineDiffStats {
  added: number
  removed: number
}

export interface LineDiffStatsOptions {
  filePath?: string
  compareEmbeddedWidgetCode?: boolean
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

function isWidgetMarkdownPath(filePath?: string): boolean {
  if (!filePath) return false
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('widgets/') && normalized.endsWith('.md')
}

function extractShowWidgetCode(content: string): string | null {
  const match = content.match(/```(?:show-widget|show_widget)\s*\n([\s\S]*?)\n```/i)
  if (!match?.[1]) return null

  try {
    const payload = JSON.parse(match[1]) as { widget_code?: unknown; widgetCode?: unknown }
    const widgetCode = payload.widget_code ?? payload.widgetCode
    return typeof widgetCode === 'string' ? widgetCode : null
  } catch {
    return null
  }
}

function expandSingleLineWidgetCode(content: string): string {
  const normalized = normalizeContent(content).trim()
  if (!normalized || normalized.includes('\n')) return normalized

  return normalized
    .replace(/>\s*</g, '>\n<')
    .replace(/\{\s*/g, '{\n')
    .replace(/\}\s*/g, '}\n')
    .replace(/;\s*/g, ';\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function normalizeContentForStats(content: string, options?: LineDiffStatsOptions): string {
  const normalized = normalizeContent(content || '')
  if (options?.compareEmbeddedWidgetCode || isWidgetMarkdownPath(options?.filePath)) {
    const widgetCode = extractShowWidgetCode(normalized)
    if (widgetCode !== null) return expandSingleLineWidgetCode(widgetCode)
  }
  return normalized
}

function countLines(value: string): number {
  if (!value) return 0
  const normalized = normalizeContent(value)
  const segments = normalized.split('\n')
  if (normalized.endsWith('\n')) {
    segments.pop()
  }
  return segments.length
}

export function calculateLineDiffStats(
  oldContent: string,
  newContent: string,
  options?: LineDiffStatsOptions
): LineDiffStats {
  const before = normalizeContentForStats(oldContent, options)
  const after = normalizeContentForStats(newContent, options)
  const chunks = diffLines(before, after)

  let added = 0
  let removed = 0

  for (const chunk of chunks) {
    const lines = countLines(chunk.value || '')
    if (chunk.added) {
      added += lines
      continue
    }
    if (chunk.removed) {
      removed += lines
    }
  }

  return { added, removed }
}
