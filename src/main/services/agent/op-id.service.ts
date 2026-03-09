/**
 * opId Idempotency Service
 *
 * Deduplicates control operations within a TTL window.
 */

import { getConfig } from '../config.service'

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_CAPACITY = 10_000

type SettledRecord<T> = {
  kind: 'settled'
  expiresAt: number
  result: T
  summary?: Record<string, unknown>
}

type PendingRecord<T> = {
  kind: 'pending'
  promise: Promise<SettledRecord<T>>
}

type OpRecord<T> = SettledRecord<T> | PendingRecord<T>

const opRecords = new Map<string, OpRecord<unknown>>()

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  if (normalized <= 0) return null
  return normalized
}

function resolveConfig(): { ttlMs: number; capacity: number } {
  const claudeCode = (getConfig().claudeCode || {}) as {
    opIdTtlMs?: unknown
    opIdCapacity?: unknown
  }
  return {
    ttlMs: toPositiveInt(claudeCode.opIdTtlMs) || DEFAULT_TTL_MS,
    capacity: toPositiveInt(claudeCode.opIdCapacity) || DEFAULT_CAPACITY
  }
}

function nowMs(): number {
  return Date.now()
}

function pruneExpired(): void {
  const now = nowMs()
  for (const [key, record] of Array.from(opRecords.entries())) {
    if (record.kind !== 'settled') continue
    if (record.expiresAt <= now) {
      opRecords.delete(key)
    }
  }
}

function enforceCapacity(capacity: number): void {
  if (opRecords.size <= capacity) return
  for (const key of opRecords.keys()) {
    opRecords.delete(key)
    if (opRecords.size <= capacity) return
  }
}

export interface IdempotentExecutionResult<T> {
  replayed: boolean
  result: T
  summary?: Record<string, unknown>
}

export async function executeIdempotentOperation<T>(params: {
  scopeKey: string
  operation: string
  opId?: string
  execute: () => Promise<T> | T
  summarize?: (result: T) => Record<string, unknown> | undefined
}): Promise<IdempotentExecutionResult<T>> {
  const normalizedOpId = typeof params.opId === 'string' ? params.opId.trim() : ''
  if (!normalizedOpId) {
    const result = await Promise.resolve(params.execute())
    return {
      replayed: false,
      result,
      summary: params.summarize?.(result)
    }
  }

  const { ttlMs, capacity } = resolveConfig()
  pruneExpired()
  const recordKey = `${params.scopeKey}:${params.operation}:${normalizedOpId}`
  const existing = opRecords.get(recordKey) as OpRecord<T> | undefined

  if (existing) {
    if (existing.kind === 'pending') {
      const settled = await existing.promise
      return {
        replayed: true,
        result: settled.result,
        summary: settled.summary
      }
    }
    if (existing.expiresAt > nowMs()) {
      return {
        replayed: true,
        result: existing.result,
        summary: existing.summary
      }
    }
    opRecords.delete(recordKey)
  }

  const pendingPromise: Promise<SettledRecord<T>> = Promise.resolve()
    .then(() => params.execute())
    .then((result) => ({
      kind: 'settled' as const,
      expiresAt: nowMs() + ttlMs,
      result,
      summary: params.summarize?.(result)
    }))

  opRecords.set(recordKey, {
    kind: 'pending',
    promise: pendingPromise
  } satisfies PendingRecord<T>)

  try {
    const settled = await pendingPromise
    opRecords.set(recordKey, settled as SettledRecord<unknown>)
    enforceCapacity(capacity)
    return {
      replayed: false,
      result: settled.result,
      summary: settled.summary
    }
  } catch (error) {
    opRecords.delete(recordKey)
    throw error
  }
}

