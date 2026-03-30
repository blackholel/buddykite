import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listConversationsMock = vi.hoisted(() => vi.fn())
const createConversationMock = vi.hoisted(() => vi.fn())
const getConversationMock = vi.hoisted(() => vi.fn())
const updateConversationMock = vi.hoisted(() => vi.fn())
const deleteConversationServiceMock = vi.hoisted(() => vi.fn())
const setConversationStatusMock = vi.hoisted(() => vi.fn())
const addMessageMock = vi.hoisted(() => vi.fn())
const updateLastMessageMock = vi.hoisted(() => vi.fn())

const stopGenerationMock = vi.hoisted(() => vi.fn())
const closeV2SessionMock = vi.hoisted(() => vi.fn())
const isGeneratingMock = vi.hoisted(() => vi.fn(() => false))
const sendToRendererMock = vi.hoisted(() => vi.fn())
const isChatModeMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('../../../src/main/services/conversation.service', () => ({
  listConversations: listConversationsMock,
  createConversation: createConversationMock,
  getConversation: getConversationMock,
  updateConversation: updateConversationMock,
  deleteConversation: deleteConversationServiceMock,
  setConversationStatus: setConversationStatusMock,
  addMessage: addMessageMock,
  updateLastMessage: updateLastMessageMock
}))

vi.mock('../../../src/main/services/agent', () => ({
  stopGeneration: stopGenerationMock,
  closeV2Session: closeV2SessionMock,
  isGenerating: isGeneratingMock,
  sendToRenderer: sendToRendererMock
}))

vi.mock('../../../src/main/services/agent/types', () => ({
  isChatMode: isChatModeMock
}))

async function loadController() {
  return import('../../../src/main/controllers/conversation.controller')
}

function getDeleteStatuses(): string[] {
  return sendToRendererMock.mock.calls
    .filter(([eventName]) => eventName === 'conversation:delete-status')
    .map(([, , , payload]) => payload.status)
}

describe('conversation.controller deleteConversation async deletion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.resetModules()

    getConversationMock.mockImplementation((_spaceId: string, _conversationId: string, options?: { includeHidden?: boolean }) => {
      if (options?.includeHidden) return null
      return { id: 'conv-1', status: 'active' }
    })
    setConversationStatusMock.mockReturnValue({ id: 'conv-1', status: 'deleting' })
    stopGenerationMock.mockResolvedValue(undefined)
    deleteConversationServiceMock.mockReturnValue(true)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('立即返回 accepted，并在后台完成 stopGeneration + 物理删除', async () => {
    const { deleteConversation } = await loadController()

    const result = await deleteConversation('space-1', 'conv-1')
    expect(result.success).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        accepted: true,
        conversationId: 'conv-1',
        opId: expect.stringMatching(/^delete-/)
      })
    )
    expect(closeV2SessionMock).toHaveBeenCalledWith('space-1', 'conv-1')
    expect(setConversationStatusMock).toHaveBeenCalledWith('space-1', 'conv-1', 'deleting')

    await vi.advanceTimersByTimeAsync(0)

    expect(stopGenerationMock).toHaveBeenCalledWith('space-1', 'conv-1')
    expect(deleteConversationServiceMock).toHaveBeenCalledWith('space-1', 'conv-1')
    expect(getDeleteStatuses()).toEqual(['accepted', 'running', 'completed'])
  })

  it('后台失败时按退避重试，超限后标记 delete_failed_hidden', async () => {
    stopGenerationMock.mockRejectedValue(new Error('stop failed'))
    const { deleteConversation } = await loadController()

    const result = await deleteConversation('space-1', 'conv-1')
    expect(result.success).toBe(true)

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(10000)
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(120000)
    await vi.advanceTimersByTimeAsync(300000)

    expect(stopGenerationMock).toHaveBeenCalledTimes(6)
    expect(deleteConversationServiceMock).not.toHaveBeenCalled()
    expect(setConversationStatusMock).toHaveBeenCalledWith('space-1', 'conv-1', 'deleting')
    expect(setConversationStatusMock).toHaveBeenCalledWith('space-1', 'conv-1', 'delete_failed_hidden')

    const deleteStatusCalls = sendToRendererMock.mock.calls
      .filter(([eventName]) => eventName === 'conversation:delete-status')
      .map(([, , , payload]) => payload)
    const retryDelays = deleteStatusCalls
      .filter((payload) => payload.status === 'retrying')
      .map((payload) => payload.retryInMs)

    expect(retryDelays).toEqual([2000, 10000, 30000, 120000, 300000])
    expect(getDeleteStatuses().at(-1)).toBe('failed_hidden')
  })
})
