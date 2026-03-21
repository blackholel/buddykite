import { describe, expect, it } from 'vitest'
import {
  buildReceiverSrcdoc,
  computePartialWidgetKey,
  parseAllShowWidgets,
  sanitizeForIframe,
  sanitizeForStreaming
} from '../../../lib/widget-sanitizer'
import {
  WIDGET_STABILITY_EVENT_TYPES,
  createWidgetStabilityEmitter
} from '../../../lib/widget-stability-events'

function widgetSegments(content: string) {
  return parseAllShowWidgets(content).filter((segment) => segment.type === 'widget')
}

describe('parseAllShowWidgets', () => {
  it('纯文本场景：保留为 text segment，不生成 widget', () => {
    const source = '这是一段普通文本，没有任何 show-widget 围栏。'
    const segments = parseAllShowWidgets(source)

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: 'text', content: source })
  })

  it('单围栏场景：解析 1 个 widget', () => {
    const source = [
      'before',
      '```show-widget',
      '{"title":"单围栏","widget_code":"<div>ok</div>"}',
      '```',
      'after'
    ].join('\n')

    const widgets = widgetSegments(source)
    expect(widgets).toHaveLength(1)
    expect(widgets[0]).toMatchObject({
      type: 'widget',
      title: '单围栏',
      widgetCode: '<div>ok</div>',
      isPartial: false
    })
  })

  it('多围栏交错场景：可提取多个 widget 并保留中间文本', () => {
    const source = [
      'text-a',
      '```show-widget',
      '{"title":"A","widget_code":"<div>a</div>"}',
      '```',
      'middle text',
      '```show-widget',
      '{"title":"B","widget_code":"<div>b</div>"}',
      '```',
      'text-z'
    ].join('\n')

    const segments = parseAllShowWidgets(source)
    const widgets = segments.filter((segment) => segment.type === 'widget')
    const texts = segments.filter((segment) => segment.type === 'text')

    expect(widgets).toHaveLength(2)
    expect(widgets[0]).toMatchObject({ title: 'A', widgetCode: '<div>a</div>' })
    expect(widgets[1]).toMatchObject({ title: 'B', widgetCode: '<div>b</div>' })
    expect(texts.some((segment) => segment.content.includes('middle text'))).toBe(true)
  })

  it('未闭合围栏场景：parseAll 回退为普通文本，不渲染 widget', () => {
    const source = [
      'prefix',
      '```show-widget',
      '{"title":"未闭合","widget_code":"<div>streaming</div>"}'
    ].join('\n')

    const segments = parseAllShowWidgets(source)
    expect(segments.some((segment) => segment.type === 'widget')).toBe(false)
    expect(segments.some((segment) => segment.type === 'text' && segment.content.includes('```show-widget'))).toBe(true)
  })

  it('坏 JSON 场景：回退为 text segment，原始内容不丢失', () => {
    const source = [
      '```show-widget',
      '{"title":"坏 JSON","widget_code":"<div>x</div>",}',
      '```'
    ].join('\n')

    const segments = parseAllShowWidgets(source)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: 'text' })
    if (segments[0].type === 'text') {
      expect(segments[0].content).toContain('坏 JSON')
      expect(segments[0].content).toContain(',}')
    }
  })
})

describe('computePartialWidgetKey', () => {
  it('同一 open fence 在 open -> closed 时 key 一致', () => {
    const openSource = [
      'intro',
      '```show-widget',
      '{"title":"Key稳定性","widget_code":"<div>open</div>"}'
    ].join('\n')
    const closedSource = `${openSource}\n\`\`\``
    const openFenceIndex = openSource.indexOf('```show-widget')

    const keyInOpen = computePartialWidgetKey(openSource, openFenceIndex, 'Key稳定性')
    const keyInClosed = computePartialWidgetKey(closedSource, openFenceIndex, 'Key稳定性')

    expect(keyInOpen).toBe(keyInClosed)
  })
})

describe('widget-sanitizer', () => {
  it('sanitizeForStreaming: 移除 script / on* 事件 / 危险 URL', () => {
    const raw = '<a href="javascript:alert(1)" onclick="boom()">x</a><script>alert(1)</script>'
    const sanitized = sanitizeForStreaming(raw)

    expect(sanitized.toLowerCase()).not.toContain('<script')
    expect(sanitized.toLowerCase()).not.toContain('onclick=')
    expect(sanitized).toContain('href="#"')
  })

  it('sanitizeForIframe: 移除 CSP meta 与 base，并清理空字符', () => {
    const raw = '\u0000<meta http-equiv="content-security-policy" content="default-src *"><base href="https://evil/">ok'
    const sanitized = sanitizeForIframe(raw)

    expect(sanitized).toBe('ok')
    expect(sanitized.toLowerCase()).not.toContain('content-security-policy')
    expect(sanitized.toLowerCase()).not.toContain('<base')
  })

  it('buildReceiverSrcdoc: 包含 connect-src none、消息类型、ResizeObserver', () => {
    const srcdoc = buildReceiverSrcdoc('<div id="root">Hello</div>')

    expect(srcdoc).toContain("connect-src 'none'")
    expect(srcdoc).toContain('widget:ready')
    expect(srcdoc).toContain('widget:resize')
    expect(srcdoc).toContain('widget:error')
    expect(srcdoc).toContain('ResizeObserver')
  })
})

describe('widget-stability-events', () => {
  it('eventType 枚举保持固定顺序', () => {
    expect(WIDGET_STABILITY_EVENT_TYPES).toEqual([
      'widget_ready',
      'widget_update_sent',
      'widget_finalize_sent',
      'widget_resize_recv',
      'widget_theme_sent',
      'widget_error_recv',
      'widget_link_open'
    ])
  })

  it('runId 缺失时不产生日志事件', () => {
    const events: unknown[] = []
    const emitter = createWidgetStabilityEmitter(
      {
        runId: '',
        conversationId: 'conv-1',
        widgetKey: 'w-1',
        instanceId: 'instance-1'
      },
      {
        sink: (event) => events.push(event)
      }
    )

    const result = emitter.emit({
      eventType: 'widget_ready',
      isPartial: true
    })

    expect(result).toBeNull()
    expect(events).toHaveLength(0)
  })

  it('同一 instanceId 下 seq 单调递增，且保留固定字段', () => {
    const events: Array<Record<string, unknown>> = []
    const emitter = createWidgetStabilityEmitter(
      {
        runId: 'run-1',
        conversationId: 'conv-1',
        widgetKey: 'w-1',
        instanceId: 'instance-1'
      },
      {
        sink: (event) => events.push(event as unknown as Record<string, unknown>),
        now: (() => {
          let now = 1000
          return () => {
            now += 25
            return now
          }
        })()
      }
    )

    emitter.emit({ eventType: 'widget_ready', isPartial: true })
    emitter.emit({ eventType: 'widget_update_sent', isPartial: true })
    emitter.emit({ eventType: 'widget_finalize_sent', isPartial: false })

    expect(events).toHaveLength(3)
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(events.every((event) => event.runId === 'run-1')).toBe(true)
    expect(events.every((event) => event.conversationId === 'conv-1')).toBe(true)
    expect(events.every((event) => event.widgetKey === 'w-1')).toBe(true)
    expect(events.every((event) => typeof event.timestamp === 'string')).toBe(true)
    expect(events.every((event) => typeof event.latencyMs === 'number')).toBe(true)
  })
})
