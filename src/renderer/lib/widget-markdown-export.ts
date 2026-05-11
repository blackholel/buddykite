export interface WidgetMarkdownExportInput {
  title?: string
  widgetCode: string
}

export interface WidgetMarkdownFileNameInput {
  messageId: string
  segmentKey: string
  now?: Date
}

function normalizeTitle(title?: string): string {
  const trimmed = title?.trim()
  return trimmed || 'Widget'
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

function sanitizeFilePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return cleaned || 'item'
}

export function buildWidgetMarkdownExport({ title, widgetCode }: WidgetMarkdownExportInput): string {
  const normalizedTitle = normalizeTitle(title)
  const payload = JSON.stringify({
    title: normalizedTitle,
    widget_code: widgetCode
  })

  return [
    `# ${normalizedTitle}`,
    '',
    '```show-widget',
    payload,
    '```',
    ''
  ].join('\n')
}

export function buildWidgetMarkdownFileName({
  messageId,
  segmentKey,
  now = new Date()
}: WidgetMarkdownFileNameInput): string {
  return `widget-${formatTimestamp(now)}-${sanitizeFilePart(messageId)}-${sanitizeFilePart(segmentKey)}.md`
}
