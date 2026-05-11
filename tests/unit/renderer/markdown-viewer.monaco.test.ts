/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const monacoHarness = vi.hoisted(() => ({
  props: null as any,
  commandHandler: null as null | (() => void),
  scrollListener: null as null | (() => void),
  scrollTop: 0,
  lastSetScrollTop: null as null | number,
  disposeCalled: false,
  loaderConfig: vi.fn(),
}))

vi.mock('monaco-editor', () => ({
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 }
}))

vi.mock('@monaco-editor/react', async () => {
  const ReactModule = await import('react')
  const fakeMonacoApi = {
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 }
  }

  return {
    loader: { config: monacoHarness.loaderConfig },
    default: (props: any) => {
      monacoHarness.props = props

      ReactModule.useEffect(() => {
        const editor = {
          addCommand: vi.fn((_cmd: number, handler: () => void) => {
            monacoHarness.commandHandler = handler
            return 1
          }),
          focus: vi.fn(),
          setScrollTop: vi.fn((nextTop: number) => {
            monacoHarness.scrollTop = nextTop
            monacoHarness.lastSetScrollTop = nextTop
          }),
          getScrollTop: vi.fn(() => monacoHarness.scrollTop),
          onDidScrollChange: vi.fn((listener: () => void) => {
            monacoHarness.scrollListener = listener
            return {
              dispose: vi.fn(() => {
                monacoHarness.disposeCalled = true
                monacoHarness.scrollListener = null
              })
            }
          })
        }

        props.onMount?.(editor, fakeMonacoApi)
      }, [props.onMount])

      return ReactModule.createElement('textarea', {
        'data-testid': 'monaco-input',
        value: props.value ?? '',
        onChange: (event: Event & { target: HTMLTextAreaElement }) => {
          props.onChange?.(event.target.value)
        }
      })
    }
  }
})

vi.mock('../../../src/renderer/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../../src/renderer/api', () => ({
  api: {
    isRemoteMode: () => false,
    openArtifact: vi.fn()
  }
}))

vi.mock('../../../src/renderer/components/chat/MarkdownRenderer', async () => {
  const ReactModule = await import('react')

  return {
    MarkdownRenderer: ({ content }: { content: string }) =>
      ReactModule.createElement('div', {
        'data-testid': 'markdown-renderer',
        'data-content': content
      }, content)
  }
})

import { MarkdownViewer } from '../../../src/renderer/components/canvas/viewers/MarkdownViewer'

function createMarkdownTab(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tab-markdown',
    type: 'markdown',
    title: 'README.md',
    content: '# Initial',
    path: '/tmp/README.md',
    workDir: '/tmp',
    isDirty: false,
    scrollPosition: 0,
    ...overrides
  } as any
}

function findButtonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text)
  )
  if (!button) {
    throw new Error(`button not found: ${text}`)
  }
  return button as HTMLButtonElement
}

describe('MarkdownViewer Monaco source mode', () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  beforeEach(() => {
    vi.useFakeTimers()
    document.documentElement.classList.remove('dark')
    monacoHarness.props = null
    monacoHarness.commandHandler = null
    monacoHarness.scrollListener = null
    monacoHarness.scrollTop = 0
    monacoHarness.lastSetScrollTop = null
    monacoHarness.disposeCalled = false
    monacoHarness.loaderConfig.mockClear()

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('切到 Source 后渲染 Monaco markdown 编辑器并带初始内容', () => {
    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab({ content: '# Hello Monaco' }),
        onContentChange: vi.fn(),
        onSave: vi.fn()
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    expect(monacoHarness.props.language).toBe('markdown')
    expect(monacoHarness.props.value).toBe('# Hello Monaco')
    expect(monacoHarness.props.options.fontSize).toBe(13)
    expect(monacoHarness.props.options.minimap).toEqual({ enabled: false })
  })

  it('输入变化后 200ms debounce 仅 flush 最新内容', () => {
    const onContentChange = vi.fn()

    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab(),
        onContentChange
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    act(() => {
      monacoHarness.props.onChange?.('draft-1')
    })
    vi.advanceTimersByTime(100)

    act(() => {
      monacoHarness.props.onChange?.('draft-2')
    })
    vi.advanceTimersByTime(100)

    act(() => {
      monacoHarness.props.onChange?.('draft-3')
    })

    vi.advanceTimersByTime(199)
    expect(onContentChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onContentChange).toHaveBeenCalledTimes(1)
    expect(onContentChange).toHaveBeenLastCalledWith('draft-3')
  })

  it('Cmd/Ctrl+S 会先 flush 最新输入再调用 onSave', () => {
    const callOrder: string[] = []

    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab(),
        onContentChange: (content: string) => {
          callOrder.push(`content:${content}`)
        },
        onSave: () => {
          callOrder.push('save')
        }
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    act(() => {
      monacoHarness.props.onChange?.('latest-draft')
    })
    vi.advanceTimersByTime(50)

    act(() => {
      monacoHarness.commandHandler?.()
    })

    expect(callOrder).toEqual(['content:latest-draft', 'save'])

    vi.advanceTimersByTime(500)
    expect(callOrder).toEqual(['content:latest-draft', 'save'])
  })

  it('Source 滚动会同步并在切换回 Source 时恢复 scrollPosition', () => {
    const onScrollChange = vi.fn()
    const onContentChange = vi.fn()
    const onSave = vi.fn()

    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab({ scrollPosition: 88 }),
        onScrollChange,
        onContentChange,
        onSave
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    expect(monacoHarness.lastSetScrollTop).toBe(88)

    act(() => {
      monacoHarness.scrollTop = 123
      monacoHarness.scrollListener?.()
    })
    expect(onScrollChange).toHaveBeenCalledWith(123)

    act(() => {
      findButtonByText(host, 'Preview').click()
    })

    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab({ scrollPosition: 66 }),
        onScrollChange,
        onContentChange,
        onSave
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    expect(monacoHarness.lastSetScrollTop).toBe(66)
  })

  it('主题切换时 Monaco theme 在 vs 与 vs-dark 间更新', async () => {
    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab(),
        onContentChange: vi.fn()
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    expect(monacoHarness.props.theme).toBe('vs')

    await act(async () => {
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })

    expect(monacoHarness.props.theme).toBe('vs-dark')
  })

  it('Preview 模式始终使用最新 draftContent 渲染 MarkdownRenderer', () => {
    act(() => {
      root.render(React.createElement(MarkdownViewer, {
        tab: createMarkdownTab(),
        onContentChange: vi.fn()
      }))
    })

    act(() => {
      findButtonByText(host, 'Source').click()
    })

    act(() => {
      monacoHarness.props.onChange?.('## Latest Draft')
    })

    act(() => {
      findButtonByText(host, 'Preview').click()
    })

    const renderer = host.querySelector('[data-testid="markdown-renderer"]') as HTMLDivElement | null
    expect(renderer?.getAttribute('data-content')).toBe('## Latest Draft')
  })
})
