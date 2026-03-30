import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../../api', () => ({
  api: {
    getAgentResourceHash: vi.fn(async () => ({ success: true, data: { hash: 'hash', sessionResourceHash: 'hash' } })),
    refreshSkillsIndex: vi.fn(async () => ({ success: true, data: null })),
    importSkillToLibrary: vi.fn(async () => ({ success: true, data: { status: 'imported' } })),
    importAgentToLibrary: vi.fn(async () => ({ success: true, data: { status: 'imported' } })),
    generateSkillDraft: vi.fn(async () => ({ success: true, data: { name: 'x', description: 'x', content: 'x' } })),
    generateAgentDraft: vi.fn(async () => ({ success: true, data: { name: 'x', description: 'x', content: 'x' } }))
  }
}))

const skills = [
  {
    name: 'zeta',
    path: '/tmp/skills/zeta',
    source: 'app',
    enabled: false,
    exposure: 'public'
  },
  {
    name: 'beta',
    path: '/tmp/skills/beta',
    source: 'app',
    enabled: true,
    exposure: 'public'
  },
  {
    name: 'alpha',
    path: '/tmp/skills/alpha',
    source: 'global',
    enabled: true,
    exposure: 'public'
  }
]

const agents = [
  {
    name: 'helper',
    path: '/tmp/agents/helper.md',
    source: 'plugin',
    enabled: true,
    exposure: 'public'
  },
  {
    name: 'reviewer',
    path: '/tmp/agents/reviewer.md',
    source: 'app',
    enabled: false,
    exposure: 'public'
  }
]

vi.mock('../../../stores/skills.store', () => ({
  useSkillsStore: () => ({
    skills,
    isLoading: false,
    loadSkills: vi.fn(async () => {}),
    openSkillsLibraryFolder: vi.fn(async () => true),
    createSkillInLibrary: vi.fn(async () => null),
    loadedWorkDir: null,
    lastRefreshReason: null,
    lastRefreshTs: null
  })
}))

vi.mock('../../../stores/agents.store', () => ({
  useAgentsStore: () => ({
    agents,
    isLoading: false,
    loadAgents: vi.fn(async () => {}),
    openAgentsLibraryFolder: vi.fn(async () => true),
    createAgentInLibrary: vi.fn(async () => null)
  })
}))

vi.mock('../../../stores/space.store', () => ({
  useSpaceStore: () => ({
    currentSpace: {
      id: 'space-1',
      path: '/tmp/space-1'
    }
  })
}))

vi.mock('../../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: null,
    spaceStates: new Map()
  })
}))

vi.mock('../../resources/ResourceCard', () => ({
  ResourceCard: (props: Record<string, any>) => (
    <div data-resource-card="true">
      {`${props.type}:${props.resource.name}:${props.resource.enabled !== false ? 'enabled' : 'disabled'}`}
    </div>
  )
}))

import { ExtensionsView } from '../ExtensionsView'

describe('ExtensionsView library mode', () => {
  it('技能模式仅展示技能，并按启用优先 + 名称排序', () => {
    const html = renderToStaticMarkup(<ExtensionsView resourceType="skill" />)

    expect(html).toContain('技能资源库')
    expect(html).not.toContain('agent:helper')
    expect(html).not.toContain('agent:reviewer')

    const alphaPos = html.indexOf('skill:alpha:enabled')
    const betaPos = html.indexOf('skill:beta:enabled')
    const zetaPos = html.indexOf('skill:zeta:disabled')
    expect(alphaPos).toBeGreaterThan(-1)
    expect(betaPos).toBeGreaterThan(-1)
    expect(zetaPos).toBeGreaterThan(-1)
    expect(alphaPos).toBeLessThan(betaPos)
    expect(betaPos).toBeLessThan(zetaPos)
  })

  it('智能体模式仅展示智能体，并按启用优先 + 名称排序', () => {
    const html = renderToStaticMarkup(<ExtensionsView resourceType="agent" />)

    expect(html).toContain('智能体资源库')
    expect(html).not.toContain('skill:alpha')
    expect(html).not.toContain('skill:beta')

    const helperPos = html.indexOf('agent:helper:enabled')
    const reviewerPos = html.indexOf('agent:reviewer:disabled')
    expect(helperPos).toBeGreaterThan(-1)
    expect(reviewerPos).toBeGreaterThan(-1)
    expect(helperPos).toBeLessThan(reviewerPos)
  })
})
