/**
 * Agent Dispatch Throttle
 *
 * Provides fail-fast backpressure for non-control send operations.
 */

import { getConfig } from '../config.service'

const DEFAULT_GLOBAL_QUEUE_LIMIT = 2048
const DEFAULT_SPACE_QUEUE_LIMIT = 256

const inFlightBySpace = new Map<string, number>()
let inFlightGlobal = 0

function createDispatchLimitError(errorCode: string, message: string): Error & { errorCode: string } {
  const error = new Error(message) as Error & { errorCode: string }
  error.errorCode = errorCode
  return error
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  if (normalized <= 0) return null
  return normalized
}

function resolveDispatchLimits(): {
  globalQueueLimit: number
  spaceQueueLimit: number
} {
  const claudeCodeConfig = (getConfig().claudeCode || {}) as {
    globalQueueLimit?: unknown
    spaceQueueLimit?: unknown
  }
  return {
    globalQueueLimit: toPositiveInteger(claudeCodeConfig.globalQueueLimit) || DEFAULT_GLOBAL_QUEUE_LIMIT,
    spaceQueueLimit: toPositiveInteger(claudeCodeConfig.spaceQueueLimit) || DEFAULT_SPACE_QUEUE_LIMIT
  }
}

/**
 * Reserve one dispatch slot for send-like commands.
 * Throws fail-fast when queue limits are exceeded.
 */
export function acquireSendDispatchSlot(spaceId: string): () => void {
  const { globalQueueLimit, spaceQueueLimit } = resolveDispatchLimits()
  const spaceInFlight = inFlightBySpace.get(spaceId) || 0

  if (inFlightGlobal >= globalQueueLimit) {
    throw createDispatchLimitError(
      'GLOBAL_QUEUE_FULL',
      `Global dispatch queue is full (${inFlightGlobal}/${globalQueueLimit})`
    )
  }

  if (spaceInFlight >= spaceQueueLimit) {
    throw createDispatchLimitError(
      'SPACE_QUEUE_FULL',
      `Dispatch queue is full for space ${spaceId} (${spaceInFlight}/${spaceQueueLimit})`
    )
  }

  inFlightGlobal += 1
  inFlightBySpace.set(spaceId, spaceInFlight + 1)

  let released = false
  return () => {
    if (released) return
    released = true

    inFlightGlobal = Math.max(0, inFlightGlobal - 1)
    const current = inFlightBySpace.get(spaceId) || 0
    if (current <= 1) {
      inFlightBySpace.delete(spaceId)
      return
    }
    inFlightBySpace.set(spaceId, current - 1)
  }
}

export function getDispatchQueueStats(): {
  inFlightGlobal: number
  inFlightBySpace: Record<string, number>
} {
  return {
    inFlightGlobal,
    inFlightBySpace: Object.fromEntries(inFlightBySpace.entries())
  }
}

