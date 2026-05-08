import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownRenderer } from '../MarkdownRenderer'

describe('MarkdownRenderer heading ids', () => {
  it('为 h1-h3 生成稳定 id，h4 不参与', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          '# Alpha',
          '## Beta',
          '### Gamma',
          '#### Delta'
        ].join('\n')}
        headingIdPrefix="msg-1"
      />
    )

    expect(html).toContain('id="msg-1-alpha"')
    expect(html).toContain('id="msg-1-beta"')
    expect(html).toContain('id="msg-1-gamma"')
    expect(html).not.toContain('id="msg-1-delta"')
  })

  it('重复标题生成稳定且不冲突 id', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          '# Title',
          '## Title',
          '### Title'
        ].join('\n')}
        headingIdPrefix="msg-dup"
      />
    )

    expect(html).toContain('id="msg-dup-title"')
    expect(html).toContain('id="msg-dup-title-2"')
    expect(html).toContain('id="msg-dup-title-3"')
  })

  it('忽略 fenced code 内的伪标题', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          '```md',
          '# fake-heading',
          '```',
          '# real-heading'
        ].join('\n')}
        headingIdPrefix="msg-code"
      />
    )

    expect(html).not.toContain('id="msg-code-fake-heading"')
    expect(html).toContain('id="msg-code-real-heading"')
  })

  it('不同 prefix 的同名标题不会冲突（覆盖 show-widget 分段场景）', () => {
    const htmlA = renderToStaticMarkup(
      <MarkdownRenderer
        content={'# Segment Heading'}
        headingIdPrefix="msg-42-seg-a"
      />
    )
    const htmlB = renderToStaticMarkup(
      <MarkdownRenderer
        content={'# Segment Heading'}
        headingIdPrefix="msg-42-seg-b"
      />
    )

    expect(htmlA).toContain('id="msg-42-seg-a-segment-heading"')
    expect(htmlB).toContain('id="msg-42-seg-b-segment-heading"')
  })
})
