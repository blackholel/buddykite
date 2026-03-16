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
