/**
 * Runtime Journal Service
 *
 * Provides runEpoch/seq allocation and lightweight WAL+snapshot persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildSessionKey } from '../../../shared/session-key'

const SNAPSHOT_VERSION = 1
const SNAPSHOT_FILE = 'runtime-snapshot.json'
const WAL_FILE = 'runtime.wal'
const SNAPSHOT_WRITE_EVERY_EVENTS = 64

interface RuntimeSnapshotPayload {
  snapshotVersion: number
  updatedAt: string
  runEpochBySession: Record<string, number>
  runEpochByRun: Record<string, number>
  lastSeqByRun: Record<string, number>
}

interface RuntimeWalEventRecord {
  kind: 'event'
  spaceId: string
  conversationId: string
  runEpoch: number
  runId: string
  seq: number
  channel: string
  ts: string
}

interface RuntimeWalRunRecord {
  kind: 'run_register'
  sessionKey: string
  runId: string
  runEpoch: number
  ts: string
}

type RuntimeWalRecord = RuntimeWalEventRecord | RuntimeWalRunRecord

let initialized = false
let writesSinceSnapshot = 0

const runEpochBySession = new Map<string, number>()
const runEpochByRun = new Map<string, number>()
const lastSeqByRun = new Map<string, number>()

function ensureStorageDir(): string {
  const dir = join(tmpdir(), 'buddykite-agent-runtime')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function snapshotFilePath(): string {
  return join(ensureStorageDir(), SNAPSHOT_FILE)
}

function walFilePath(): string {
  return join(ensureStorageDir(), WAL_FILE)
}

function toRunKey(sessionKey: string, runId: string): string {
  return `${sessionKey}:${runId}`
}

function toRunSeqKey(sessionKey: string, runEpoch: number, runId: string): string {
  return `${sessionKey}:${runEpoch}:${runId}`
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  if (normalized < 0) return null
  return normalized
}

function loadFromSnapshot(): void {
  const file = snapshotFilePath()
  if (!existsSync(file)) return

  try {
    const payload = JSON.parse(readFileSync(file, 'utf-8')) as RuntimeSnapshotPayload
    if (!payload || payload.snapshotVersion !== SNAPSHOT_VERSION) return

    for (const [sessionKey, epoch] of Object.entries(payload.runEpochBySession || {})) {
      const normalized = parsePositiveInt(epoch)
      if (normalized == null) continue
      runEpochBySession.set(sessionKey, normalized)
    }
    for (const [runKey, epoch] of Object.entries(payload.runEpochByRun || {})) {
      const normalized = parsePositiveInt(epoch)
      if (normalized == null) continue
      runEpochByRun.set(runKey, normalized)
    }
    for (const [runSeqKey, seq] of Object.entries(payload.lastSeqByRun || {})) {
      const normalized = parsePositiveInt(seq)
      if (normalized == null) continue
      lastSeqByRun.set(runSeqKey, normalized)
    }
  } catch (error) {
    console.warn('[Agent][RuntimeJournal] Failed to load snapshot, fallback to WAL replay', {
      cause: error instanceof Error ? error.message : String(error)
    })
  }
}

function applyWalRecord(record: RuntimeWalRecord): void {
  if (record.kind === 'run_register') {
    const normalizedEpoch = parsePositiveInt(record.runEpoch)
    if (normalizedEpoch == null) return
    const current = runEpochBySession.get(record.sessionKey) || 0
    if (normalizedEpoch > current) {
      runEpochBySession.set(record.sessionKey, normalizedEpoch)
    }
    runEpochByRun.set(toRunKey(record.sessionKey, record.runId), normalizedEpoch)
    return
  }

  const normalizedEpoch = parsePositiveInt(record.runEpoch)
  const normalizedSeq = parsePositiveInt(record.seq)
  if (normalizedEpoch == null || normalizedSeq == null) return

  const sessionKey = buildSessionKey(record.spaceId, record.conversationId)
  const runSeqKey = toRunSeqKey(sessionKey, normalizedEpoch, record.runId)
  const currentSeq = lastSeqByRun.get(runSeqKey) || 0
  if (normalizedSeq > currentSeq) {
    lastSeqByRun.set(runSeqKey, normalizedSeq)
  }
}

function replayWal(): void {
  const file = walFilePath()
  if (!existsSync(file)) return

  try {
    const content = readFileSync(file, 'utf-8')
    if (!content) return

    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const record = JSON.parse(trimmed) as RuntimeWalRecord
        if (!record || typeof record !== 'object') continue
        if (record.kind !== 'event' && record.kind !== 'run_register') continue
        applyWalRecord(record)
      } catch {
        // Ignore malformed (possibly half-written) lines.
      }
    }
  } catch (error) {
    console.warn('[Agent][RuntimeJournal] Failed to replay WAL', {
      cause: error instanceof Error ? error.message : String(error)
    })
  }
}

function ensureInitialized(): void {
  if (initialized) return
  loadFromSnapshot()
  replayWal()
  initialized = true
}

function appendWalRecord(record: RuntimeWalRecord): void {
  try {
    appendFileSync(walFilePath(), `${JSON.stringify(record)}\n`, 'utf-8')
    writesSinceSnapshot += 1
  } catch (error) {
    console.warn('[Agent][RuntimeJournal] Failed to append WAL record', {
      cause: error instanceof Error ? error.message : String(error)
    })
  }
}

function flushSnapshot(): void {
  const file = snapshotFilePath()
  const tempFile = `${file}.tmp`
  const payload: RuntimeSnapshotPayload = {
    snapshotVersion: SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    runEpochBySession: Object.fromEntries(runEpochBySession.entries()),
    runEpochByRun: Object.fromEntries(runEpochByRun.entries()),
    lastSeqByRun: Object.fromEntries(lastSeqByRun.entries())
  }

  try {
    writeFileSync(tempFile, JSON.stringify(payload), 'utf-8')
    renameSync(tempFile, file)
    writesSinceSnapshot = 0
  } catch (error) {
    console.warn('[Agent][RuntimeJournal] Failed to flush snapshot', {
      cause: error instanceof Error ? error.message : String(error)
    })
  }
}

function maybeFlushSnapshot(): void {
  if (writesSinceSnapshot < SNAPSHOT_WRITE_EVERY_EVENTS) return
  flushSnapshot()
}

export function allocateRunEpoch(spaceId: string, conversationId: string, runId: string): number {
  ensureInitialized()
  const sessionKey = buildSessionKey(spaceId, conversationId)
  const nextEpoch = (runEpochBySession.get(sessionKey) || 0) + 1
  runEpochBySession.set(sessionKey, nextEpoch)
  runEpochByRun.set(toRunKey(sessionKey, runId), nextEpoch)

  appendWalRecord({
    kind: 'run_register',
    sessionKey,
    runId,
    runEpoch: nextEpoch,
    ts: new Date().toISOString()
  })
  maybeFlushSnapshot()
  return nextEpoch
}

export function resolveRunEpoch(sessionKey: string, runId: string): number | null {
  ensureInitialized()
  return runEpochByRun.get(toRunKey(sessionKey, runId)) || null
}

export function nextRunEventSeq(params: {
  spaceId: string
  conversationId: string
  runEpoch: number
  runId: string
  channel: string
  persist?: boolean
}): number {
  ensureInitialized()
  const { spaceId, conversationId, runEpoch, runId, channel, persist = true } = params
  const sessionKey = buildSessionKey(spaceId, conversationId)
  const runSeqKey = toRunSeqKey(sessionKey, runEpoch, runId)
  const nextSeq = (lastSeqByRun.get(runSeqKey) || 0) + 1
  lastSeqByRun.set(runSeqKey, nextSeq)

  if (persist) {
    appendWalRecord({
      kind: 'event',
      spaceId,
      conversationId,
      runEpoch,
      runId,
      seq: nextSeq,
      channel,
      ts: new Date().toISOString()
    })
    maybeFlushSnapshot()
  }
  return nextSeq
}

export function flushRuntimeJournalSnapshot(): void {
  ensureInitialized()
  flushSnapshot()
}
