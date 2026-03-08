import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => {
      if (options?.name) {
        return key.replace('{name}', options.name)
      }
      return key
    }
  })
}))

vi.mock('../../../src/renderer/components/skills/SkillSuggestionCard', async () => {
  const actual = await vi.importActual<typeof import('../../../src/renderer/components/skills/SkillSuggestionCard')>(
    '../../../src/renderer/components/skills/SkillSuggestionCard'
  )

  return {
    ...actual,
    ResourceSuggestionCard: ({ suggestion }: { suggestion: { name: string } }) =>
      React.createElement('div', { 'data-testid': 'resource-suggestion-card' }, suggestion.name)
  }
})

import { MarkdownRenderer } from '../../../src/renderer/components/chat/MarkdownRenderer'

describe('MarkdownRenderer enhanced rendering', () => {
  it('相对图片路径会解析为 kite-file 绝对路径', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: '![架构图](./assets/diagram.png)',
        workDir: '/tmp/project'
      })
    )

    expect(html).toContain('src="kite-file:///tmp/project/assets/diagram.png"')
  })

  it('支持安全的原生 HTML 渲染并过滤脚本标签', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: '<div class="note">safe<script>alert("x")</script></div>'
      })
    )

    expect(html).toContain('<div class="note">safe</div>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert("x")')
  })

  it('裸文件路径会被识别为可交互文件节点', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: '请修改 src/main/index.ts 然后提交',
        workDir: '/tmp/project'
      })
    )

    expect(html).toContain('data-md-file-chip="true"')
    expect(html).toContain('index.ts')
  })
})
