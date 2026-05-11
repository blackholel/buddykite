import { resolveEffectiveConversationAi } from './agent/ai-config-resolver'
import { resolveProvider } from './agent/provider-resolver'

export interface MarkdownExportTitleInput {
  userPrompt?: string
  assistantText: string
  widgetTitles?: string[]
  fallbackTitle?: string
}

export interface MarkdownExportTitleResult {
  title: string
  source: 'ai' | 'fallback'
  error?: string
}

const TITLE_REQUEST_TIMEOUT_MS = 8_000

function trimText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function sanitizeMarkdownExportTitle(title: string | undefined): string {
  const cleaned = (title || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[#\s"'“”‘’`*_~.-]+|[\s"'“”‘’`*_~.-]+$/g, '')
    .replace(/\s*\.md$/i, '')
    .trim()

  return cleaned || '对话导出'
}

function truncateForPrompt(value: string | undefined, limit: number): string {
  const text = (value || '').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function resolveMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.endsWith('/v1/messages')) return normalized
  return `${normalized}/v1/messages`
}

function extractTextFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>

  const contentBlocks = Array.isArray(record.content)
    ? (record.content as Array<Record<string, unknown>>)
    : []
  const contentTexts = contentBlocks
    .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : undefined))
    .filter((item): item is string => Boolean(item))
  if (contentTexts.length > 0) return contentTexts.join('\n')

  const outputText = trimText(record.output_text)
  if (outputText) return outputText

  const choices = Array.isArray(record.choices)
    ? (record.choices as Array<Record<string, unknown>>)
    : []
  const choiceTexts: string[] = []
  for (const choice of choices) {
    const message = choice.message
    if (!message || typeof message !== 'object') continue
    const messageRecord = message as Record<string, unknown>
    const directText = trimText(messageRecord.content)
    if (directText) {
      choiceTexts.push(directText)
      continue
    }
    if (Array.isArray(messageRecord.content)) {
      for (const item of messageRecord.content as Array<Record<string, unknown>>) {
        const text = trimText(item?.text)
        if (text) choiceTexts.push(text)
      }
    }
  }

  return choiceTexts.length > 0 ? choiceTexts.join('\n') : undefined
}

function parseTitleFromText(rawText: string): string | undefined {
  const normalized = rawText.trim()
  if (!normalized) return undefined

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    const title = trimText(parsed.title)
    if (title) return title
  } catch {
    // continue
  }

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim()) as Record<string, unknown>
      const title = trimText(parsed.title)
      if (title) return title
    } catch {
      // continue
    }
  }

  return normalized.split('\n').map((line) => line.trim()).find(Boolean)
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]+/g, '')
}

export function buildFallbackMarkdownExportTitle(input: MarkdownExportTitleInput): string {
  const explicitFallback = sanitizeMarkdownExportTitle(input.fallbackTitle)
  if (explicitFallback !== '对话导出') return explicitFallback

  const h1Match = input.assistantText.match(/^#\s+(.+)$/m)
  if (h1Match?.[1]?.trim()) {
    return sanitizeMarkdownExportTitle(stripInlineMarkdown(h1Match[1]))
  }

  const widgetTitle = input.widgetTitles?.find((title) => title.trim().length > 0)
  if (widgetTitle) return sanitizeMarkdownExportTitle(widgetTitle)

  return '对话导出'
}

export function buildMarkdownExportTitlePrompt(input: MarkdownExportTitleInput): string {
  return [
    '你是一个 Markdown 文档标题生成器。',
    '根据下面的用户提问、助手回答摘要和图表标题，生成一个适合作为 Markdown H1 和文件名的短标题。',
    '规则：中文 8-24 字或英文 3-8 个词；不要引号；不要扩展名；不要使用 / \\ : * ? " < > |；只返回 JSON：{"title":"..."}。',
    '',
    `用户提问：${truncateForPrompt(input.userPrompt, 500)}`,
    `助手回答摘要：${truncateForPrompt(input.assistantText, 1200)}`,
    `图表标题：${(input.widgetTitles || []).map((title) => title.trim()).filter(Boolean).join('、')}`
  ].join('\n')
}

export async function generateMarkdownExportTitle(
  input: MarkdownExportTitleInput
): Promise<MarkdownExportTitleResult> {
  const fallbackTitle = buildFallbackMarkdownExportTitle(input)

  try {
    const effectiveAi = resolveEffectiveConversationAi('kite-temp', 'markdown-export-title')
    if (!effectiveAi.profile.apiKey?.trim()) {
      return { title: fallbackTitle, source: 'fallback', error: 'API key not configured' }
    }

    const resolved = await resolveProvider(effectiveAi.profile, effectiveAi.effectiveModel)
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), TITLE_REQUEST_TIMEOUT_MS)
    const response = await (async () => {
      try {
        return await fetch(resolveMessagesUrl(resolved.anthropicBaseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': resolved.anthropicApiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: resolved.sdkModel,
            temperature: 0,
            max_tokens: 80,
            stream: false,
            messages: [
              {
                role: 'user',
                content: buildMarkdownExportTitlePrompt(input)
              }
            ]
          }),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeoutHandle)
      }
    })()

    if (!response.ok) {
      return { title: fallbackTitle, source: 'fallback', error: `HTTP ${response.status}` }
    }

    const payload = await response.json()
    const text = extractTextFromPayload(payload)
    const aiTitle = text ? sanitizeMarkdownExportTitle(parseTitleFromText(text)) : ''
    if (!aiTitle || aiTitle === '对话导出') {
      return { title: fallbackTitle, source: 'fallback', error: 'Empty title' }
    }

    return { title: aiTitle, source: 'ai' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate title'
    return { title: fallbackTitle, source: 'fallback', error: message }
  }
}
