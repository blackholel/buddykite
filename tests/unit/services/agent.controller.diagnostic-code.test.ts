import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessageMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/main/services/agent', () => ({
  sendMessage: sendMessageMock,
  guideLiveInput: vi.fn(),
  stopGeneration: vi.fn(),
  handleToolApproval: vi.fn(),
  handleAskUserQuestionResponse: vi.fn(),
  isGenerating: vi.fn(() => false),
  getActiveSessions: vi.fn(() => []),
  getSessionState: vi.fn(() => null),
  testMcpConnections: vi.fn(async () => ({ success: true, servers: [] }))
}))

import { sendMessage, sendWorkflowStepMessage } from '../../../src/main/controllers/agent.controller'

describe('agent.controller sendMessage diagnostic code passthrough', () => {
  beforeEach(() => {
    sendMessageMock.mockReset()
  })

  it('passes diagnosticCode from agent sendMessage to controller response', async () => {
    sendMessageMock.mockResolvedValue({
      accepted: true,
      diagnosticCode: 'DIRECTIVE_EXPLICIT_NOT_FOUND'
    })

    const result = await sendMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: '/x-article-publisher test'
    } as any)

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      accepted: true,
      diagnosticCode: 'DIRECTIVE_EXPLICIT_NOT_FOUND'
    })
  })

  it('keeps workflow-step routing and diagnosticCode passthrough', async () => {
    sendMessageMock.mockResolvedValue({
      accepted: true,
      diagnosticCode: 'DIRECTIVE_AMBIGUOUS_ALIAS'
    })

    const result = await sendWorkflowStepMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-2',
      message: '/x-article-publisher test'
    } as any)

    expect(result.success).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock.mock.calls[0]?.[1]?.invocationContext).toBe('workflow-step')
    expect(result.data).toEqual({
      accepted: true,
      diagnosticCode: 'DIRECTIVE_AMBIGUOUS_ALIAS'
    })
  })
})
