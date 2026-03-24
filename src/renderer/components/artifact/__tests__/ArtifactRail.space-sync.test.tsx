/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Artifact } from '../../../types'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { canvasState, apiMock, translateFn } = vi.hoisted(() => ({
  canvasState: {
    openFile: vi.fn(async () => {}),
    tabs: [] as Array<{ id: string; type?: string; path?: string; spaceId?: string }>,
    activeTabId: null as string | null
  },
  apiMock: {
    isRemoteMode: vi.fn(() => false),
    listArtifacts: vi.fn(async (_spaceId: string) => ({ success: true, data: [] as Artifact[] })),
    listArtifactsTree: vi.fn(async (_spaceId: string) => ({ success: true, data: [] })),
    getSpace: vi.fn(async (_spaceId: string) => ({ success: true, data: { path: '/workspace' } })),
    getKiteSpace: vi.fn(async () => ({ success: true, data: { path: '/workspace' } })),
    createArtifactEntry: vi.fn(async () => ({ success: true, data: { path: '/workspace/created.md' } })),
    openArtifact: vi.fn(async (_path: string) => ({ success: true })),
    downloadArtifact: vi.fn(),
    showArtifactInFolder: vi.fn(async () => ({ success: true })),
    renameArtifact: vi.fn(async () => ({ success: true })),
    deleteArtifact: vi.fn(async () => ({ success: true })),
    moveArtifact: vi.fn(async () => ({ success: true }))
  },
  translateFn: (key: string) => key
}))

vi.mock('../../../api', () => ({ api: apiMock }))

vi.mock('../../../stores/canvas.store', () => ({
  useCanvasStore: (selector: (state: typeof canvasState) => unknown) => selector(canvasState)
}))

vi.mock('../../../stores/chat.store', () => ({
  useIsGenerating: () => true
}))

vi.mock('../../../stores/onboarding.store', () => ({
  useOnboardingStore: () => ({
    isActive: false,
    currentStep: null,
    completeOnboarding: vi.fn()
  })
}))

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: translateFn
  })
}))

vi.mock('../../icons/ToolIcons', () => ({
  FileIcon: () => <span>icon</span>
}))

vi.mock('lucide-react', () => {
  const Icon = () => <span>icon</span>
  return {
    ChevronRight: Icon,
    FolderOpen: Icon,
    Monitor: Icon,
    LayoutGrid: Icon,
    FolderTree: Icon,
    X: Icon,
    Bell: Icon,
    ChevronDown: Icon,
    Download: Icon,
    Eye: Icon,
    FilePlus: Icon,
    FolderPlus: Icon,
    RefreshCw: Icon,
    Pencil: Icon,
    Copy: Icon,
    Trash2: Icon,
    ExternalLink: Icon
  }
})

vi.mock('react-arborist', () => ({
  Tree: ({ data, children }: { data: Array<Record<string, unknown>>; children: (props: unknown) => JSX.Element }) => (
    <div>
      {data.map((item) => {
        const node = {
          data: item,
          isSelected: false,
          isFocused: false,
          isOpen: false,
          toggle: vi.fn()
        }
        return (
          <div key={String(item.id)}>
            {children({ node, style: {}, dragHandle: undefined })}
          </div>
        )
      })}
    </div>
  )
}))

import { ArtifactRail } from '../ArtifactRail'
import { ArtifactCard } from '../ArtifactCard'
import { ArtifactTree } from '../ArtifactTree'

function createRenderer() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  return {
    container,
    async render(element: JSX.Element) {
      await act(async () => {
        root.render(element)
      })
    },
    async rerender(element: JSX.Element) {
      await act(async () => {
        root.render(element)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  }
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0)
    })
  })
}

async function waitFor(assertion: () => void) {
  let lastError: unknown = null
  for (let i = 0; i < 100; i += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => {
        window.setTimeout(resolve, 10)
      })
    }
  }
  throw lastError
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('Artifact rail space sync', () => {
  beforeEach(() => {
    canvasState.openFile.mockClear()
    canvasState.tabs = []
    canvasState.activeTabId = null

    apiMock.listArtifacts.mockClear()
    apiMock.listArtifactsTree.mockClear()
    apiMock.getSpace.mockClear()
    apiMock.createArtifactEntry.mockClear()

    localStorage.clear()
  })

  it('在同一 space 重复点击文件时，openFile 使用 spaceId 语义调用（生命周期去重由 store 负责）', async () => {
    const artifact: Artifact = {
      id: 'a1',
      name: 'readme.md',
      path: '/workspace/readme.md',
      type: 'file',
      extension: 'md'
    }

    const renderer = createRenderer()
    await renderer.render(<ArtifactCard artifact={artifact} spaceId="space-a" />)
    await flushEffects()

    const card = renderer.container.querySelector('.artifact-card')
    if (card == null) throw new Error('card not found')

    await click(card)
    await click(card)

    expect(canvasState.openFile).toHaveBeenCalledTimes(2)
    expect(canvasState.openFile).toHaveBeenNthCalledWith(1, 'space-a', '/workspace/readme.md', 'readme.md')
    expect(canvasState.openFile).toHaveBeenNthCalledWith(2, 'space-a', '/workspace/readme.md', 'readme.md')

    await renderer.unmount()
  })

  it('active artifact 仅在 activeTab 属于当前 space 时高亮', async () => {
    apiMock.listArtifacts.mockImplementation(async (spaceId: string) => ({
      success: true,
      data: [{
        id: spaceId + '-f1',
        name: 'same.md',
        path: '/workspace/same.md',
        type: 'file',
        extension: 'md'
      } satisfies Artifact]
    }))

    canvasState.tabs = [{
      id: 'tab-1',
      type: 'file',
      path: '/workspace/same.md',
      spaceId: 'space-b'
    }]
    canvasState.activeTabId = 'tab-1'

    localStorage.setItem('kite:artifact-view-mode', 'card')

    const renderer = createRenderer()
    await renderer.render(<ArtifactRail spaceId="space-a" isTemp={false} />)
    await waitFor(() => {
      expect(renderer.container.textContent).toContain('same.md')
    })

    let activeCard = renderer.container.querySelector('[data-active="true"]')
    expect(activeCard).toBeNull()

    canvasState.tabs = [{
      id: 'tab-1',
      type: 'file',
      path: '/workspace/same.md',
      spaceId: 'space-a'
    }]

    await renderer.rerender(<ArtifactRail spaceId="space-a" isTemp={false} />)
    await waitFor(() => {
      const nextActiveCard = renderer.container.querySelector('[data-active="true"]')
      expect(nextActiveCard).not.toBeNull()
    })

    activeCard = renderer.container.querySelector('[data-active="true"]')
    expect(activeCard).not.toBeNull()

    await renderer.unmount()
  })

  it('spaceId 变更时，rail 会重新加载对应 space 的 artifacts', async () => {
    apiMock.listArtifacts.mockImplementation(async (spaceId: string) => ({
      success: true,
      data: [{
        id: spaceId + '-f1',
        name: spaceId + '.md',
        path: '/workspace/' + spaceId + '.md',
        type: 'file',
        extension: 'md'
      } satisfies Artifact]
    }))

    localStorage.setItem('kite:artifact-view-mode', 'card')

    const renderer = createRenderer()
    await renderer.render(<ArtifactRail spaceId="space-a" isTemp={false} />)
    await waitFor(() => {
      expect(apiMock.listArtifacts).toHaveBeenCalledWith('space-a')
    })

    await renderer.rerender(<ArtifactRail spaceId="space-b" isTemp={false} />)
    await waitFor(() => {
      expect(apiMock.listArtifacts).toHaveBeenCalledWith('space-b')
    })

    await renderer.unmount()
  })

  it('space 切换后会忽略过期的 artifacts 响应', async () => {
    let resolveSpaceA: ((value: { success: boolean; data: Artifact[] }) => void) | null = null
    const spaceAResponse = new Promise<{ success: boolean; data: Artifact[] }>((resolve) => {
      resolveSpaceA = resolve
    })

    apiMock.listArtifacts.mockImplementation((spaceId: string) => {
      if (spaceId === 'space-a') return spaceAResponse
      return Promise.resolve({
        success: true,
        data: [{
          id: 'space-b-f1',
          name: 'space-b.md',
          path: '/workspace/space-b.md',
          type: 'file',
          extension: 'md'
        } satisfies Artifact]
      })
    })

    localStorage.setItem('kite:artifact-view-mode', 'card')

    const renderer = createRenderer()
    await renderer.render(<ArtifactRail spaceId="space-a" isTemp={false} />)
    await renderer.rerender(<ArtifactRail spaceId="space-b" isTemp={false} />)

    await waitFor(() => {
      expect(renderer.container.textContent).toContain('space-b.md')
    })

    if (resolveSpaceA == null) throw new Error('space-a resolver not set')
    resolveSpaceA({
      success: true,
      data: [{
        id: 'space-a-f1',
        name: 'space-a.md',
        path: '/workspace/space-a.md',
        type: 'file',
        extension: 'md'
      }]
    })
    await flushEffects()

    expect(renderer.container.textContent).toContain('space-b.md')
    expect(renderer.container.textContent).not.toContain('space-a.md')

    await renderer.unmount()
  })

  it('tree row 点击与 create-then-open 都走 openFile(spaceId, path, name)', async () => {
    apiMock.listArtifactsTree.mockResolvedValue({
      success: true,
      data: [{
        id: 'f-1',
        name: 'tree.md',
        path: '/workspace/tree.md',
        extension: 'md',
        type: 'file'
      }]
    })

    const renderer = createRenderer()
    await renderer.render(<ArtifactTree spaceId="space-a" />)
    await waitFor(() => {
      const treeRowText = Array.from(renderer.container.querySelectorAll('span')).find((el) => el.textContent === 'tree.md')
      expect(treeRowText).not.toBeNull()
    })

    const treeRowText = Array.from(renderer.container.querySelectorAll('span')).find((el) => el.textContent === 'tree.md')
    if (treeRowText == null) throw new Error('tree row not found')
    const treeRow = treeRowText.closest('div')
    if (treeRow == null) throw new Error('tree row container not found')
    await click(treeRow)

    expect(canvasState.openFile).toHaveBeenCalledWith('space-a', '/workspace/tree.md', 'tree.md')

    const newFileButton = renderer.container.querySelector('button[title="New file"]')
    if (newFileButton == null) throw new Error('new file button not found')
    await click(newFileButton)

    const input = renderer.container.querySelector('input') as HTMLInputElement | null
    if (input == null) throw new Error('create input not found')

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setValue == null) throw new Error('input value setter not found')
      setValue.call(input, 'created.md')
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    let createButton: HTMLButtonElement | null = null
    await waitFor(() => {
      const found = Array.from(renderer.container.querySelectorAll('button')).find((el) => el.textContent === 'Create')
      if (!(found instanceof HTMLButtonElement)) throw new Error('create button not found')
      if (found.disabled) throw new Error('create button is disabled')
      createButton = found
    })
    if (createButton == null) throw new Error('create button not found')
    await click(createButton)

    await waitFor(() => {
      expect(canvasState.openFile).toHaveBeenNthCalledWith(2, 'space-a', '/workspace/created.md', 'created.md')
    })

    await renderer.unmount()
  })
})
