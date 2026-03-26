import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkflow,
  mockListSkills,
  mockListAgents,
  mockUpdateWorkflow,
  mockCreateConversation,
  mockSendMessageToConversation
} = vi.hoisted(() => ({
  mockGetWorkflow: vi.fn(),
  mockListSkills: vi.fn(),
  mockListAgents: vi.fn(),
  mockUpdateWorkflow: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockSendMessageToConversation: vi.fn()
}))

vi.mock('../../api', () => ({
  api: {
    getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
    listSkills: (...args: unknown[]) => mockListSkills(...args),
    listAgents: (...args: unknown[]) => mockListAgents(...args),
    updateWorkflow: (...args: unknown[]) => mockUpdateWorkflow(...args)
  }
}))

vi.mock('../../i18n', () => ({
  getCurrentLanguage: () => 'zh-CN'
}))

const chatState = {
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  sendMessageToConversation: (...args: unknown[]) => mockSendMessageToConversation(...args),
  getCachedConversation: () => null
}

vi.mock('../chat.store', () => ({
  useChatStore: {
    getState: () => chatState
  }
}))

const spaceState = {
  currentSpace: {
    id: 'space-1',
    path: '/workspace/space-1'
  },
  spaces: [] as Array<{ id: string; path: string }>
}

vi.mock('../space.store', () => ({
  useSpaceStore: {
    getState: () => spaceState
  }
}))

import { useWorkflowsStore } from '../workflows.store'

describe('WorkflowsStore runtime validation', () => {
  beforeEach(() => {
    useWorkflowsStore.setState({
      workflows: [],
      loadedSpaceId: null,
      activeWorkflow: null,
      activeRun: null,
      isLoading: false,
      error: null
    })

    mockGetWorkflow.mockReset()
    mockListSkills.mockReset()
    mockListAgents.mockReset()
    mockUpdateWorkflow.mockReset()
    mockCreateConversation.mockReset()
    mockSendMessageToConversation.mockReset()

    mockListAgents.mockResolvedValue({ success: true, data: [] })
    mockUpdateWorkflow.mockResolvedValue({ success: true, data: {} })
    mockCreateConversation.mockResolvedValue({ id: 'conv-1' })
    mockSendMessageToConversation.mockResolvedValue(undefined)
  })

  it('allows running workflow when step uses global skill', async () => {
    mockGetWorkflow.mockResolvedValue({
      success: true,
      data: {
        id: 'wf-1',
        spaceId: 'space-1',
        name: 'global-flow',
        steps: [{ id: 'step-1', type: 'skill', name: 'app-skill' }]
      }
    })
    mockListSkills.mockResolvedValue({
      success: true,
      data: [{ name: 'app-skill', source: 'app' }]
    })

    await useWorkflowsStore.getState().runWorkflow('space-1', 'wf-1')

    expect(mockCreateConversation).toHaveBeenCalled()
    expect(mockSendMessageToConversation).toHaveBeenCalled()
    const firstCall = mockSendMessageToConversation.mock.calls[0]
    expect(firstCall[2]).toBe('/app-skill')
    expect(firstCall[7]).toBe('workflow-step')
    expect(useWorkflowsStore.getState().error).toBeNull()
  })

  it('keeps legacy command step prefix when running historical workflows', async () => {
    mockGetWorkflow.mockResolvedValue({
      success: true,
      data: {
        id: 'wf-legacy-command',
        spaceId: 'space-1',
        name: 'legacy-command-flow',
        steps: [{ id: 'step-1', type: 'command', name: 'review', input: 'target=prod' }]
      }
    })
    mockListSkills.mockResolvedValue({ success: true, data: [] })

    await useWorkflowsStore.getState().runWorkflow('space-1', 'wf-legacy-command')

    expect(mockCreateConversation).toHaveBeenCalled()
    expect(mockSendMessageToConversation).toHaveBeenCalled()
    const firstCall = mockSendMessageToConversation.mock.calls[0]
    expect(firstCall[2]).toBe('/review target=prod')
    expect(useWorkflowsStore.getState().error).toBeNull()
  })

  it('blocks workflow when step resource is unavailable', async () => {
    mockGetWorkflow.mockResolvedValue({
      success: true,
      data: {
        id: 'wf-2',
        spaceId: 'space-1',
        name: 'invalid-flow',
        steps: [{ id: 'step-1', type: 'skill', name: 'missing-skill' }]
      }
    })
    mockListSkills.mockResolvedValue({
      success: true,
      data: []
    })

    await useWorkflowsStore.getState().runWorkflow('space-1', 'wf-2')

    expect(mockCreateConversation).not.toHaveBeenCalled()
    expect(useWorkflowsStore.getState().error).toContain('Workflow contains unavailable resources')
  })
})
