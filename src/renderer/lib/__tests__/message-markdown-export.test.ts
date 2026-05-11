import { describe, expect, it } from 'vitest'
import type { Message } from '../../types'
import {
  buildMessageMarkdownExport,
  buildMessageMarkdownFallbackTitle,
  buildMessageMarkdownFileName
} from '../message-markdown-export'

const assistantMessage: Message = {
  id: 'assistant-1',
  role: 'assistant',
  content: [
    '回答前文',
    '',
    '```show-widget',
    '{"title":"图表","widget_code":"<div data-label=\\"A\\">line1\\nline2</div><script>console.log(\\"</script>\\")</script>"}',
    '```',
    '',
    '回答后文'
  ].join('\n'),
  timestamp: '2026-05-11T00:00:00.000Z'
}

const userMessage: Message = {
  id: 'user-1',
  role: 'user',
  content: '请帮我生成图表',
  timestamp: '2026-05-11T00:00:00.000Z'
}

describe('message-markdown-export', () => {
  it('包含上一条用户提问和 assistant 原始 show-widget 内容', () => {
    const markdown = buildMessageMarkdownExport({
      title: '分析结果',
      userMessage,
      assistantMessage
    })

    expect(markdown).toContain('# 分析结果')
    expect(markdown).toContain('## 提问\n\n请帮我生成图表')
    expect(markdown).toContain('## 回答')
    expect(markdown).toContain('```show-widget')
    expect(markdown).toContain('<script>console.log(\\"</script>\\")</script>')
  })

  it('没有上一条用户消息时只输出回答区块', () => {
    const markdown = buildMessageMarkdownExport({
      title: '分析结果',
      assistantMessage
    })

    expect(markdown).not.toContain('## 提问')
    expect(markdown).toContain('## 回答')
  })

  it('文件名清理非法字符并包含时间和消息 ID', () => {
    const name = buildMessageMarkdownFileName({
      title: '坏/标题:测试?.md',
      messageId: 'msg/1:bad',
      now: new Date(2026, 4, 11, 9, 8, 7)
    })

    expect(name).toBe('坏-标题-测试-20260511-090807-msg-1-bad.md')
  })

  it('fallback 标题优先使用 H1，其次 widget title', () => {
    expect(buildMessageMarkdownFallbackTitle({
      assistantContent: '# **正式标题**\n\n正文',
      widgetTitles: ['图表标题']
    })).toBe('正式标题')

    expect(buildMessageMarkdownFallbackTitle({
      assistantContent: '正文',
      widgetTitles: ['图表标题']
    })).toBe('图表标题')
  })
})
