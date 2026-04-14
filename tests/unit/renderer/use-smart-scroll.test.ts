/** @vitest-environment jsdom */

import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSmartScroll } from '../../../src/renderer/hooks/useSmartScroll'

interface HarnessOptions {
  threshold?: number
  deps?: unknown[]
  entryKey?: string | null
  forceToLatestOnEntry?: boolean
  entryScrollBehavior?: ScrollBehavior
  renderBottom?: boolean
}

interface HarnessApi {
  showScrollButton: boolean
  handleScroll: () => void
}

function setScrollMetrics(
  container: HTMLDivElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }
): void {
  Object.defineProperty(container, 'scrollTop', {
    value: metrics.scrollTop,
    writable: true,
    configurable: true
  })
  Object.defineProperty(container, 'scrollHeight', {
    value: metrics.scrollHeight,
    configurable: true
  })
  Object.defineProperty(container, 'clientHeight', {
    value: metrics.clientHeight,
    configurable: true
  })
}

function Harness({
  options,
  onApi
}: {
  options: HarnessOptions
  onApi: (api: HarnessApi) => void
}): React.ReactElement {
  const api = useSmartScroll(options)

  useEffect(() => {
    onApi({
      showScrollButton: api.showScrollButton,
      handleScroll: api.handleScroll
    })
  }, [api.handleScroll, api.showScrollButton, onApi])

  return React.createElement(
    'div',
    {
      ref: api.containerRef,
      onScroll: api.handleScroll,
      'data-testid': 'container'
    },
    React.createElement('div', { style: { height: '200px' } }),
    options.renderBottom === false
      ? null
      : React.createElement('div', { ref: api.bottomRef, 'data-testid': 'bottom' })
  )
}

describe('useSmartScroll', () => {
  let host: HTMLDivElement
  let root: Root
  let latestApi: HarnessApi | null
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView
  let scrollIntoViewMock: ReturnType<typeof vi.fn>

  const onApi = (api: HarnessApi): void => {
    latestApi = api
  }

  const renderHarness = (options: HarnessOptions): void => {
    act(() => {
      root.render(React.createElement(Harness, { options, onApi }))
    })
  }

  const getContainer = (): HTMLDivElement => {
    const container = host.querySelector<HTMLDivElement>('[data-testid="container"]')
    if (!container) {
      throw new Error('container not found')
    }
    return container
  }

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  beforeEach(() => {
    latestApi = null
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    originalScrollIntoView = Element.prototype.scrollIntoView
    scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  it('entryKey 不变时不会额外触发进场滚动', () => {
    renderHarness({
      deps: [0],
      entryKey: 'conv-1',
      forceToLatestOnEntry: true,
      entryScrollBehavior: 'auto'
    })
    scrollIntoViewMock.mockClear()

    renderHarness({
      deps: [0],
      entryKey: 'conv-1',
      forceToLatestOnEntry: true,
      entryScrollBehavior: 'auto'
    })

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })

  it('entryKey 变化且开启 forceToLatestOnEntry 时会强制滚动到底部', () => {
    renderHarness({
      deps: [0],
      entryKey: 'conv-1',
      forceToLatestOnEntry: true,
      entryScrollBehavior: 'auto'
    })

    const container = getContainer()
    setScrollMetrics(container, { scrollTop: 500, scrollHeight: 1200, clientHeight: 400 })
    act(() => {
      latestApi?.handleScroll()
    })
    setScrollMetrics(container, { scrollTop: 100, scrollHeight: 1200, clientHeight: 400 })
    act(() => {
      latestApi?.handleScroll()
    })
    expect(latestApi?.showScrollButton).toBe(true)
    scrollIntoViewMock.mockClear()

    renderHarness({
      deps: [0],
      entryKey: 'conv-2',
      forceToLatestOnEntry: true,
      entryScrollBehavior: 'auto'
    })

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1)
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })
    expect(latestApi?.showScrollButton).toBe(false)
  })

  it('目标锚点尚未挂载时会在后续渲染中重试进场滚动', () => {
    renderHarness({
      deps: [0],
      entryKey: 'conv-1',
      forceToLatestOnEntry: true,
      entryScrollBehavior: 'auto',
      renderBottom: false
    })

    expect(scrollIntoViewMock).not.toHaveBeenCalled()

    renderHarness({
      deps: [1],
      entryKey: 'conv-1',
      forceToLatestOnEntry: true,
      entryScrollBehavior: 'auto',
      renderBottom: true
    })

    const autoCalls = scrollIntoViewMock.mock.calls.filter(
      (args) => args[0]?.behavior === 'auto' && args[0]?.block === 'end'
    )
    expect(autoCalls.length).toBe(1)
  })

  it('用户上滑后流式更新不会自动跟随', () => {
    renderHarness({ deps: [0] })
    const container = getContainer()

    setScrollMetrics(container, { scrollTop: 500, scrollHeight: 1200, clientHeight: 600 })
    act(() => {
      latestApi?.handleScroll()
    })
    setScrollMetrics(container, { scrollTop: 120, scrollHeight: 1200, clientHeight: 600 })
    act(() => {
      latestApi?.handleScroll()
    })
    expect(latestApi?.showScrollButton).toBe(true)
    scrollIntoViewMock.mockClear()

    renderHarness({ deps: [1] })

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })

  it('回到底部后会恢复自动跟随', () => {
    renderHarness({ deps: [0] })
    const container = getContainer()

    setScrollMetrics(container, { scrollTop: 500, scrollHeight: 1200, clientHeight: 600 })
    act(() => {
      latestApi?.handleScroll()
    })
    setScrollMetrics(container, { scrollTop: 120, scrollHeight: 1200, clientHeight: 600 })
    act(() => {
      latestApi?.handleScroll()
    })
    renderHarness({ deps: [1] })
    scrollIntoViewMock.mockClear()

    setScrollMetrics(container, { scrollTop: 600, scrollHeight: 1200, clientHeight: 600 })
    act(() => {
      latestApi?.handleScroll()
    })
    expect(latestApi?.showScrollButton).toBe(false)

    renderHarness({ deps: [2] })

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1)
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
  })
})
