import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../../../types'

const { canvasState } = vi.hoisted(() => ({
  canvasState: {
    openFile: vi.fn(async () => {})
  }
}))

vi.mock('../../../api', () => ({
  api: {
    createArtifactEntry: vi.fn(),
    generateMarkdownExportTitle: vi.fn()
  }
}))

vi.mock('../../../stores/canvas.store', () => ({
  useCanvasStore: (selector: (state: typeof canvasState) => unknown) => selector(canvasState)
}))

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../WidgetRenderer', () => ({
  WidgetRenderer: ({ widgetCode }: { widgetCode: string }) =>
    React.createElement('div', { 'data-testid': 'widget-renderer' }, widgetCode)
}))

import { MessageItem } from '../MessageItem'

const widgetMessage: Message = {
  id: 'msg-1',
  role: 'assistant',
  content: [
    'before',
    '```show-widget',
    '{"title":"Revenue","widget_code":"<div data-label=\\"A\\">ok</div>"}',
    '```',
    'after'
  ].join('\n'),
  timestamp: '2026-05-11T00:00:00.000Z'
}

describe('MessageItem widget markdown save', () => {
  it('assistant widget 渲染保存按钮', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message: widgetMessage,
        spaceId: 'space-a',
        workDir: '/workspace'
      })
    )

    expect(html).toContain('data-testid="save-widget-markdown"')
    expect(html).toContain('aria-label="Save chart as Markdown"')
    expect(html).toContain('data-testid="widget-renderer"')
  })

  it('非 streaming assistant 消息展示整段回复保存按钮', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message: widgetMessage,
        previousUserMessage: {
          id: 'user-1',
          role: 'user',
          content: '请生成图表',
          timestamp: '2026-05-11T00:00:00.000Z'
        },
        spaceId: 'space-a',
        workDir: '/workspace'
      })
    )

    expect(html).toContain('data-testid="save-message-markdown"')
    expect(html).toContain('aria-label="Save reply as Markdown"')
  })

  it('streaming 消息不展示整段回复保存按钮', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message: {
          ...widgetMessage,
          isStreaming: true
        },
        spaceId: 'space-a',
        workDir: '/workspace'
      })
    )

    expect(html).not.toContain('data-testid="save-message-markdown"')
  })

  it('缺少 spaceId 或 workDir 时不展示保存按钮', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageItem, {
        message: widgetMessage,
        workDir: '/workspace'
      })
    )

    expect(html).not.toContain('data-testid="save-widget-markdown"')
    expect(html).not.toContain('data-testid="save-message-markdown"')
  })
})
