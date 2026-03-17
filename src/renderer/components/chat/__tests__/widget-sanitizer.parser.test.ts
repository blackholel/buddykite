import { describe, expect, it } from 'vitest'
import {
  computePartialWidgetKey,
  parseAllShowWidgets,
  parseShowWidgetsForStreaming,
  sanitizeForIframe,
  sanitizeForStreaming
} from '../../../lib/widget-sanitizer'

describe('widget-sanitizer', () => {
  it('parses text + widget mixed content for persisted messages', () => {
    const input = [
      'before',
      '```show-widget',
      '{"title":"Sales","widget_code":"<div>ok</div>"}',
      '```',
      'after'
    ].join('\n')

    const segments = parseAllShowWidgets(input)
    expect(segments.map((segment) => segment.type)).toEqual(['text', 'widget', 'text'])
    expect(segments[1]).toMatchObject({
      type: 'widget',
      title: 'Sales'
    })
  })

  it('parses uppercase SHOW-WIDGET fence and underscore show_widget fence', () => {
    const inputUpper = [
      '```SHOW-WIDGET',
      '{"title":"Upper","widget_code":"<div>upper</div>"}',
      '```'
    ].join('\n')
    const inputUnderscore = [
      '```show_widget',
      '{"title":"Under","widget_code":"<div>under</div>"}',
      '```'
    ].join('\n')

    const upperSegments = parseAllShowWidgets(inputUpper)
    const underSegments = parseAllShowWidgets(inputUnderscore)

    expect(upperSegments.some((segment) => segment.type === 'widget')).toBe(true)
    expect(underSegments.some((segment) => segment.type === 'widget')).toBe(true)
  })

  it('supports structured widget payload and converts table props to HTML widget', () => {
    const input = [
      '```show-widget',
      JSON.stringify({
        type: 'table',
        title: '结构化表格',
        description: '从 schema 转成 HTML widget',
        props: {
          columns: ['模块', '结论'],
          rows: [
            ['数据层', '通过'],
            ['渲染层', '通过']
          ]
        }
      }),
      '```'
    ].join('\n')

    const segments = parseAllShowWidgets(input)
    const widget = segments.find((segment) => segment.type === 'widget')
    expect(widget?.type).toBe('widget')
    if (widget?.type === 'widget') {
      expect(widget.widgetCode).toContain('<table')
      expect(widget.widgetCode).toContain('结构化表格')
      expect(widget.widgetCode).toContain('渲染层')
    }
  })

  it('extracts partial widget during streaming and truncates script', () => {
    const input = [
      '```show-widget',
      '{"title":"Live","widget_code":"<div>safe</div><script>alert(1)</script>"}'
    ].join('\n')

    const segments = parseShowWidgetsForStreaming(input)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'widget',
      isPartial: true,
      title: 'Live'
    })
    expect((segments[0] as { widgetCode: string }).widgetCode).toContain('<div>safe</div>')
    expect((segments[0] as { widgetCode: string }).widgetCode.toLowerCase()).not.toContain('<script')
  })

  it('extracts partial widget for uppercase SHOW-WIDGET fence in streaming', () => {
    const input = [
      '```SHOW-WIDGET',
      '{"title":"Live","widget_code":"<div>partial</div>"}'
    ].join('\n')

    const segments = parseShowWidgetsForStreaming(input)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'widget',
      isPartial: true,
      title: 'Live'
    })
  })

  it('keeps partial key stable after fence closes', () => {
    const open = [
      '```show-widget',
      '{"title":"Stable","widget_code":"<div>1</div>"}'
    ].join('\n')
    const closed = `${open}\n\`\`\``
    const openKey = computePartialWidgetKey(open, 0, 'Stable')
    const closedSegments = parseAllShowWidgets(closed)
    const closedWidget = closedSegments.find((segment) => segment.type === 'widget')

    expect(closedWidget?.type).toBe('widget')
    expect(closedWidget && 'key' in closedWidget ? closedWidget.key : '').toBe(openKey)
  })

  it('streaming sanitizer strips event handler and dangerous url', () => {
    const html = '<a href="javascript:alert(1)" onclick="run()">go</a>'
    const cleaned = sanitizeForStreaming(html)
    expect(cleaned.toLowerCase()).not.toContain('javascript:')
    expect(cleaned.toLowerCase()).not.toContain('onclick=')
  })

  it('iframe sanitizer keeps script (light clean only)', () => {
    const html = '<div>ok</div><script>console.log(1)</script>'
    const cleaned = sanitizeForIframe(html)
    expect(cleaned).toContain('<script>')
  })
})
