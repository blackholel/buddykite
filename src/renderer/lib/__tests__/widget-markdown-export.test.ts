import { describe, expect, it } from 'vitest'
import {
  buildWidgetMarkdownExport,
  buildWidgetMarkdownFileName
} from '../widget-markdown-export'

function extractPayload(markdown: string): { title: string; widget_code: string } {
  const match = markdown.match(/```show-widget\n([\s\S]*?)\n```/)
  if (!match) throw new Error('show-widget payload not found')
  return JSON.parse(match[1])
}

describe('widget-markdown-export', () => {
  it('title 缺失时生成默认标题', () => {
    const markdown = buildWidgetMarkdownExport({ widgetCode: '<div>ok</div>' })

    expect(markdown).toContain('# Widget')
    expect(extractPayload(markdown)).toEqual({
      title: 'Widget',
      widget_code: '<div>ok</div>'
    })
  })

  it('widget_code 包含引号、换行和 script 时仍可还原', () => {
    const widgetCode = '<div data-label="A">line1\nline2</div><script>console.log("</script>")</script>'
    const markdown = buildWidgetMarkdownExport({ title: '图表', widgetCode })

    expect(markdown).toContain('```show-widget')
    expect(extractPayload(markdown)).toEqual({
      title: '图表',
      widget_code: widgetCode
    })
  })

  it('文件名包含时间与清理后的 message / segment 标识', () => {
    const filename = buildWidgetMarkdownFileName({
      messageId: 'msg/1:bad',
      segmentKey: 'w 42',
      now: new Date(2026, 4, 11, 9, 8, 7)
    })

    expect(filename).toBe('widget-20260511-090807-msg-1-bad-w-42.md')
  })
})
