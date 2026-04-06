/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '../../../stores/composer.store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => {
  if (key === 'Describe the skill you want to create, Kite will help you create it') {
    return '输入你想创建的技能内容，Kite 会帮你创建一个技能'
  }
  return key
}

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({ t }),
  getCurrentLanguage: () => 'zh-CN'
}))

vi.mock('../../../api', () => ({
  api: {
    resolveFileContext: vi.fn(async () => ({ success: true, data: null }))
  }
}))

vi.mock('../../../stores/onboarding.store', () => ({
  useOnboardingStore: (selector: (state: any) => unknown) => selector({
    isActive: false,
    currentStep: null
  })
}))

vi.mock('../../../stores/space.store', () => ({
  useSpaceStore: (selector: (state: any) => unknown) => selector({
    currentSpace: { id: 'space-1', path: '/tmp/space-1' },
    spaces: [],
    haloSpace: null
  })
}))

const skillsStoreState = {
  skills: [],
  loadedWorkDir: '/tmp/space-1',
  loadSkills: vi.fn(async () => {})
}

vi.mock('../../../stores/skills.store', () => ({
  useSkillsStore: Object.assign(
    (selector: (state: any) => unknown) => selector(skillsStoreState),
    { getState: () => skillsStoreState }
  )
}))

const agentsStoreState = {
  agents: [],
  loadedWorkDir: '/tmp/space-1',
  loadAgents: vi.fn(async () => {})
}

vi.mock('../../../stores/agents.store', () => ({
  useAgentsStore: Object.assign(
    (selector: (state: any) => unknown) => selector(agentsStoreState),
    { getState: () => agentsStoreState }
  )
}))

vi.mock('../../../stores/app.store', () => ({
  useAppStore: (selector: (state: any) => unknown) => selector({
    starterExperienceHiddenForSession: true
  })
}))

vi.mock('../../../stores/composer-mru.store', () => ({
  getComposerMruMap: vi.fn(() => ({})),
  touchComposerMru: vi.fn()
}))

vi.mock('../../onboarding/onboardingData', () => ({
  getOnboardingPrompt: () => 'onboarding prompt'
}))

vi.mock('../ImageAttachmentPreview', () => ({
  ImageAttachmentPreview: () => null
}))

vi.mock('../FileContextPreview', () => ({
  FileContextPreview: () => null
}))

vi.mock('../ModelSwitcher', () => ({
  ModelSwitcher: () => null
}))

vi.mock('../ComposerTriggerPanel', () => ({
  ComposerTriggerPanel: () => null
}))

vi.mock('../../skills', () => ({
  SkillsDropdown: () => null
}))

vi.mock('../../../../shared/types/ai-profile', () => ({
  getAiSetupState: () => ({
    configured: true,
    reason: null
  })
}))

import { InputArea } from '../InputArea'

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

function buildInputArea() {
  return (
    <InputArea
      onSend={vi.fn()}
      onStop={vi.fn()}
      isGenerating={false}
      modeSwitching={false}
      placeholder="Describe what you want to get done, Kite will start immediately"
      isCompact={true}
      spaceId="space-1"
      workDir="/tmp/space-1"
      mode="code"
      onModeChange={vi.fn()}
      conversation={{ id: 'conv-skill' }}
      config={{} as any}
      hasConversationStarted={true}
      slashRuntimeMode="native"
      slashCommandsSnapshot={{
        runId: null,
        snapshotVersion: 0,
        emittedAt: null,
        commands: [],
        source: null
      }}
    />
  )
}

async function clickElement(element: Element | null) {
  if (!element) throw new Error('element not found')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('InputArea skill creator bootstrap chip', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  beforeEach(() => {
    useComposerStore.getState().clearInserts()
    useComposerStore.getState().clearBootstrapChips()
  })

  it('consumes bootstrap chip once and restores placeholder after chip removal', async () => {
    useComposerStore.getState().queueBootstrapChip('conv-skill', {
      id: 'skill:skill-creator',
      type: 'skill',
      displayName: 'skill-creator',
      token: '/skill-creator'
    })

    const renderer = createRenderer()
    await renderer.render(buildInputArea())
    await flushAsyncWork()

    const chipLabelCount = () => renderer.container.querySelectorAll('.space-studio-chip .font-medium').length

    expect(chipLabelCount()).toBe(1)

    const textarea = renderer.container.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('textarea not found')
    }
    expect(textarea.placeholder).toBe('输入你想创建的技能内容，Kite 会帮你创建一个技能')

    await renderer.rerender(buildInputArea())
    await flushAsyncWork()
    expect(chipLabelCount()).toBe(1)

    await clickElement(renderer.container.querySelector('[aria-label="Delete"]'))
    await flushAsyncWork()

    expect(chipLabelCount()).toBe(0)
    expect(textarea.placeholder).toBe('Describe what you want to get done, Kite will start immediately')

    await renderer.unmount()
  })
})
