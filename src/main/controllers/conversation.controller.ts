/**
 * Conversation Controller - Unified business logic for conversation operations
 * Used by both IPC handlers and HTTP routes
 */

import { randomUUID } from 'crypto'
import {
  listConversations as serviceListConversations,
  createConversation as serviceCreateConversation,
  getConversation as serviceGetConversation,
  updateConversation as serviceUpdateConversation,
  deleteConversation as serviceDeleteConversation,
  setConversationStatus,
  addMessage as serviceAddMessage,
  updateLastMessage as serviceUpdateLastMessage
} from '../services/conversation.service'
import { stopGeneration, closeV2Session, isGenerating, sendToRenderer } from '../services/agent'
import { isChatMode } from '../services/agent/types'

export interface ControllerResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

interface DeleteConversationAcceptedPayload {
  accepted: true
  opId: string
  conversationId: string
}

interface DeleteTask {
  opId: string
  spaceId: string
  conversationId: string
  attempt: number
  running: boolean
  timeoutId: NodeJS.Timeout | null
}

const DELETE_RETRY_DELAYS_MS = [2000, 10000, 30000, 120000, 300000]
const deleteTasksByKey = new Map<string, DeleteTask>()

function toDeleteTaskKey(spaceId: string, conversationId: string): string {
  return `${spaceId}:${conversationId}`
}

function generateDeleteOpId(): string {
  return `delete-${randomUUID()}`
}

function emitDeleteStatus(
  task: DeleteTask,
  status: 'accepted' | 'running' | 'retrying' | 'completed' | 'failed_hidden',
  data: Record<string, unknown> = {}
): void {
  sendToRenderer('conversation:delete-status', task.spaceId, task.conversationId, {
    type: 'conversation_delete_status',
    status,
    opId: task.opId,
    conversationId: task.conversationId,
    attempt: task.attempt,
    ...data
  })
}

function clearTaskTimeout(task: DeleteTask): void {
  if (task.timeoutId) {
    clearTimeout(task.timeoutId)
    task.timeoutId = null
  }
}

function scheduleDeleteTask(task: DeleteTask, delayMs: number): void {
  clearTaskTimeout(task)
  task.timeoutId = setTimeout(() => {
    void runDeleteTask(task)
  }, delayMs)
}

async function runDeleteTask(task: DeleteTask): Promise<void> {
  if (task.running) {
    return
  }
  const key = toDeleteTaskKey(task.spaceId, task.conversationId)
  task.running = true
  task.timeoutId = null
  task.attempt += 1
  emitDeleteStatus(task, 'running')

  try {
    const stopPromise = stopGeneration(task.spaceId, task.conversationId)
    const deletePromise = stopPromise.then(() => {
      serviceDeleteConversation(task.spaceId, task.conversationId)
    })
    await Promise.all([stopPromise, deletePromise])
    deleteTasksByKey.delete(key)
    emitDeleteStatus(task, 'completed')
  } catch (error) {
    const delayMs = DELETE_RETRY_DELAYS_MS[task.attempt - 1]
    if (typeof delayMs === 'number') {
      emitDeleteStatus(task, 'retrying', {
        retryInMs: delayMs,
        error: error instanceof Error ? error.message : String(error)
      })
      scheduleDeleteTask(task, delayMs)
    } else {
      setConversationStatus(task.spaceId, task.conversationId, 'delete_failed_hidden')
      deleteTasksByKey.delete(key)
      emitDeleteStatus(task, 'failed_hidden', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  } finally {
    task.running = false
  }
}

function enqueueConversationDelete(spaceId: string, conversationId: string): DeleteTask {
  const key = toDeleteTaskKey(spaceId, conversationId)
  const existingTask = deleteTasksByKey.get(key)
  if (existingTask) {
    if (!existingTask.running && !existingTask.timeoutId) {
      scheduleDeleteTask(existingTask, 0)
    }
    return existingTask
  }

  const task: DeleteTask = {
    opId: generateDeleteOpId(),
    spaceId,
    conversationId,
    attempt: 0,
    running: false,
    timeoutId: null
  }
  deleteTasksByKey.set(key, task)
  scheduleDeleteTask(task, 0)
  return task
}

/**
 * List all conversations for a space
 */
export function listConversations(spaceId: string): ControllerResponse {
  try {
    const conversations = serviceListConversations(spaceId)
    return { success: true, data: conversations }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Create a new conversation
 */
export function createConversation(spaceId: string, title?: string): ControllerResponse {
  try {
    const conversation = serviceCreateConversation(spaceId, title)
    return { success: true, data: conversation }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Get a specific conversation
 */
export function getConversation(spaceId: string, conversationId: string): ControllerResponse {
  try {
    const conversation = serviceGetConversation(spaceId, conversationId)
    if (conversation) {
      return { success: true, data: conversation }
    }
    return { success: false, error: 'Conversation not found' }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Update a conversation
 */
export function updateConversation(
  spaceId: string,
  conversationId: string,
  updates: Record<string, unknown>
): ControllerResponse {
  try {
    if (Object.prototype.hasOwnProperty.call(updates, 'mode') && !isChatMode(updates.mode)) {
      return {
        success: false,
        error: `Invalid conversation mode: ${String(updates.mode)}`
      }
    }

    if (updates.ai && isGenerating(spaceId, conversationId)) {
      return {
        success: false,
        error: 'Cannot update conversation AI config while generation is in progress'
      }
    }

    const conversation = serviceUpdateConversation(spaceId, conversationId, updates)
    if (conversation) {
      return { success: true, data: conversation }
    }
    return { success: false, error: 'Failed to update conversation' }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Delete a conversation
 */
export async function deleteConversation(spaceId: string, conversationId: string): Promise<ControllerResponse> {
  try {
    const activeConversation = serviceGetConversation(spaceId, conversationId)
    const hiddenConversation = activeConversation
      ? null
      : serviceGetConversation(spaceId, conversationId, { includeHidden: true })

    if (!activeConversation && !hiddenConversation) {
      return { success: false, error: 'Conversation not found' }
    }

    if (activeConversation) {
      setConversationStatus(spaceId, conversationId, 'deleting')
    } else if (hiddenConversation?.status === 'delete_failed_hidden') {
      setConversationStatus(spaceId, conversationId, 'deleting')
    }

    closeV2Session(spaceId, conversationId)
    const task = enqueueConversationDelete(spaceId, conversationId)
    emitDeleteStatus(task, 'accepted')

    const payload: DeleteConversationAcceptedPayload = {
      accepted: true,
      opId: task.opId,
      conversationId
    }
    return { success: true, data: payload }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Add a message to a conversation
 */
export function addMessage(
  spaceId: string,
  conversationId: string,
  message: { role: string; content: string }
): ControllerResponse {
  try {
    const newMessage = serviceAddMessage(spaceId, conversationId, message as any)
    return { success: true, data: newMessage }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Update the last message in a conversation
 */
export function updateLastMessage(
  spaceId: string,
  conversationId: string,
  updates: Record<string, unknown>
): ControllerResponse {
  try {
    const message = serviceUpdateLastMessage(spaceId, conversationId, updates)
    if (message) {
      return { success: true, data: message }
    }
    return { success: false, error: 'Failed to update message' }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}
