import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/agent/ai-config-resolver', () => ({
  resolveEffectiveConversationAi: vi.fn(() => ({
    profile: {
      id: 'profile-1',
      apiKey: 'key',
      apiUrl: 'https://api.example.com',
      defaultModel: 'model'
    },
    effectiveModel: 'model'
  }))
}))

vi.mock('../../../src/main/services/agent/provider-resolver', () => ({
  resolveProvider: vi.fn(async () => ({
    anthropicBaseUrl: 'https://api.example.com',
    anthropicApiKey: 'key',
    sdkModel: 'model'
  }))
}))

import {
  buildFallbackMarkdownExportTitle,
  buildMarkdownExportTitlePrompt,
  generateMarkdownExportTitle,
  sanitizeMarkdownExportTitle
} from '../../../src/main/services/markdown-export-title.service'

describe('markdown export title service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('清理标题中的文件非法字符和 md 扩展名', () => {
    expect(sanitizeMarkdownExportTitle(' "坏/标题:测试?.md" ')).toBe('坏 标题 测试')
  })

  it('fallback 优先使用显式标题、H1、widget title', () => {
    expect(buildFallbackMarkdownExportTitle({
      assistantText: '正文',
      fallbackTitle: '本地标题',
      widgetTitles: ['图表标题']
    })).toBe('本地标题')

    expect(buildFallbackMarkdownExportTitle({
      assistantText: '# **文档标题**\n\n正文',
      widgetTitles: ['图表标题']
    })).toBe('文档标题')

    expect(buildFallbackMarkdownExportTitle({
      assistantText: '正文',
      widgetTitles: ['图表标题']
    })).toBe('图表标题')
  })

  it('标题 prompt 不包含 widget_code', () => {
    const prompt = buildMarkdownExportTitlePrompt({
      userPrompt: '生成图表',
      assistantText: '回答摘要',
      widgetTitles: ['收入图表']
    })

    expect(prompt).toContain('收入图表')
    expect(prompt).not.toContain('widget_code')
  })

  it('模型返回标题时使用 AI 标题', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"title":"好心态底层公式"}' }]
      })
    })))

    const result = await generateMarkdownExportTitle({
      userPrompt: '问题',
      assistantText: '回答',
      fallbackTitle: '本地标题'
    })

    expect(result).toEqual({ title: '好心态底层公式', source: 'ai' })
  })

  it('模型失败时返回 fallback 标题', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    })))

    const result = await generateMarkdownExportTitle({
      assistantText: '回答',
      fallbackTitle: '本地标题'
    })

    expect(result.title).toBe('本地标题')
    expect(result.source).toBe('fallback')
  })
})
