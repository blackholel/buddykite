import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../WidgetRenderer', () => ({
  WidgetRenderer: ({ title, widgetCode }: { title?: string; widgetCode: string }) => (
    <div data-testid="widget-renderer" data-title={title}>
      {widgetCode}
    </div>
  )
}))

import { MarkdownRenderer } from '../MarkdownRenderer'

describe('MarkdownRenderer show-widget rendering', () => {
  it('Markdown 中的 show-widget 围栏渲染为 WidgetRenderer，并保留前后文本', () => {
    const content = [
      '# Report',
      '',
      'before',
      '',
      '```show-widget',
      '{"title":"Chart","widget_code":"<div>chart</div>"}',
      '```',
      '',
      'after'
    ].join('\n')

    const html = renderToStaticMarkup(
      <MarkdownRenderer content={content} headingIdPrefix="doc" />
    )

    expect(html).toContain('id="doc-t-0-report"')
    expect(html).toContain('before')
    expect(html).toContain('data-testid="widget-renderer"')
    expect(html).toContain('data-title="Chart"')
    expect(html).toContain('&lt;div&gt;chart&lt;/div&gt;')
    expect(html).toContain('after')
    expect(html).not.toContain('language-show-widget')
  })

  it('Markdown 中多个 show-widget 围栏按顺序渲染，并保留穿插文本', () => {
    const content = [
      'summary before',
      '',
      '```show-widget',
      '{"title":"Chart A","widget_code":"<div>a</div>"}',
      '```',
      '',
      'middle explanation',
      '',
      '```show-widget',
      '{"title":"Chart B","widget_code":"<div>b</div>"}',
      '```',
      '',
      'summary after'
    ].join('\n')

    const html = renderToStaticMarkup(<MarkdownRenderer content={content} />)

    expect(html.match(/data-testid="widget-renderer"/g)).toHaveLength(2)
    expect(html).toContain('summary before')
    expect(html).toContain('data-title="Chart A"')
    expect(html).toContain('&lt;div&gt;a&lt;/div&gt;')
    expect(html).toContain('middle explanation')
    expect(html).toContain('data-title="Chart B"')
    expect(html).toContain('&lt;div&gt;b&lt;/div&gt;')
    expect(html).toContain('summary after')
    expect(html).not.toContain('language-show-widget')
  })

  it('普通 HTML 与普通代码块仍按原 Markdown 行为渲染', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          '<details><summary>More</summary>Content</details>',
          '',
          '```html',
          '<div>raw</div>',
          '```'
        ].join('\n')}
      />
    )

    expect(html).toContain('<details>')
    expect(html).toContain('language-html')
    expect(html).toContain('hljs-name')
    expect(html).toContain('raw')
    expect(html).not.toContain('data-testid="widget-renderer"')
  })
})
