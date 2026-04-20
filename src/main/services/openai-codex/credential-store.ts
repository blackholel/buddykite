import type {
  OpenAICodexCredential,
  OpenAICodexCredentialStore,
  OpenAIProviderId
} from './types'
import { dirname } from 'path'
import * as fs from 'fs'
import { writeFile } from 'fs/promises'

function isActive(credential: OpenAICodexCredential): boolean {
  return !credential.revokedAt
}

function toCompositeKey(
  tenantId: string,
  providerId: OpenAIProviderId,
  accountId: string | undefined
): string {
  return `${tenantId}:${providerId}:${accountId || 'default'}`
}

function compactCredentials(credentials: OpenAICodexCredential[]): {
  credentials: OpenAICodexCredential[]
  changed: boolean
} {
  const seen = new Set<string>()
  const nextReversed: OpenAICodexCredential[] = []
  let changed = false

  for (let i = credentials.length - 1; i >= 0; i -= 1) {
    const credential = credentials[i]
    const compositeKey = toCompositeKey(
      credential.tenantId,
      credential.providerId,
      credential.accountId || undefined
    )
    if (seen.has(compositeKey)) {
      changed = true
      continue
    }
    seen.add(compositeKey)
    nextReversed.push(credential)
  }

  if (!changed) {
    return { credentials, changed: false }
  }

  return {
    credentials: nextReversed.reverse(),
    changed: true
  }
}

function pickLatestActiveCredential(
  credentials: OpenAICodexCredential[]
): OpenAICodexCredential | null {
  for (let i = credentials.length - 1; i >= 0; i -= 1) {
    const credential = credentials[i]
    if (isActive(credential)) {
      return credential
    }
  }
  return null
}

export class InMemoryOpenAICodexCredentialStore implements OpenAICodexCredentialStore {
  private readonly byId = new Map<string, OpenAICodexCredential>()
  private readonly byCompositeKey = new Map<string, string>()

  async getActive(
    tenantId: string,
    providerId: OpenAIProviderId,
    accountId?: string
  ): Promise<OpenAICodexCredential | null> {
    const compositeKey = toCompositeKey(tenantId, providerId, accountId)
    const credentialId = this.byCompositeKey.get(compositeKey)
    if (credentialId) {
      const credential = this.byId.get(credentialId)
      if (credential && isActive(credential)) {
        return credential
      }
    }

    const candidates = Array.from(this.byId.values()).filter(credential => {
      if (credential.tenantId !== tenantId) return false
      if (credential.providerId !== providerId) return false
      return isActive(credential)
    })
    if (candidates.length === 0) {
      return null
    }

    if (accountId && candidates.length > 1) {
      return null
    }
    return pickLatestActiveCredential(candidates)
  }

  async upsert(credential: OpenAICodexCredential): Promise<void> {
    const nextCompositeKey = toCompositeKey(credential.tenantId, credential.providerId, credential.accountId || undefined)
    const existing = this.byId.get(credential.id)
    if (existing) {
      const prevCompositeKey = toCompositeKey(existing.tenantId, existing.providerId, existing.accountId || undefined)
      if (prevCompositeKey !== nextCompositeKey && this.byCompositeKey.get(prevCompositeKey) === credential.id) {
        this.byCompositeKey.delete(prevCompositeKey)
      }
    }

    const prevCredentialId = this.byCompositeKey.get(nextCompositeKey)
    if (prevCredentialId && prevCredentialId !== credential.id) {
      this.byId.delete(prevCredentialId)
    }

    this.byId.set(credential.id, credential)
    this.byCompositeKey.set(nextCompositeKey, credential.id)
  }

  async markRevoked(credentialId: string, _reason: string): Promise<void> {
    const credential = this.byId.get(credentialId)
    if (!credential) {
      return
    }

    this.byId.set(credentialId, {
      ...credential,
      revokedAt: Date.now()
    })
  }
}

interface CredentialStoreSnapshot {
  credentials: OpenAICodexCredential[]
}

interface SharedFileStoreState {
  snapshot: CredentialStoreSnapshot | null
  writeQueue: Promise<void>
}

function readSnapshot(filePath: string): CredentialStoreSnapshot {
  if (!fs.existsSync(filePath)) {
    return { credentials: [] }
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<CredentialStoreSnapshot>
  if (!Array.isArray(parsed.credentials)) {
    return { credentials: [] }
  }
  return {
    credentials: parsed.credentials
  }
}

async function writeSnapshot(filePath: string, snapshot: CredentialStoreSnapshot): Promise<void> {
  if (!fs.existsSync(dirname(filePath))) {
    fs.mkdirSync(dirname(filePath), { recursive: true })
  }
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
}

function cloneSnapshot(snapshot: CredentialStoreSnapshot): CredentialStoreSnapshot {
  return {
    credentials: snapshot.credentials.map(credential => ({ ...credential }))
  }
}

export class FileOpenAICodexCredentialStore implements OpenAICodexCredentialStore {
  private static readonly sharedState = new Map<string, SharedFileStoreState>()

  constructor(private readonly filePath: string) {}

  private getState(): SharedFileStoreState {
    const existing = FileOpenAICodexCredentialStore.sharedState.get(this.filePath)
    if (existing) {
      return existing
    }
    const created: SharedFileStoreState = {
      snapshot: null,
      writeQueue: Promise.resolve()
    }
    FileOpenAICodexCredentialStore.sharedState.set(this.filePath, created)
    return created
  }

  private ensureLoaded(): CredentialStoreSnapshot {
    const state = this.getState()
    if (!state.snapshot) {
      const loaded = readSnapshot(this.filePath)
      const compacted = compactCredentials(loaded.credentials)
      state.snapshot = {
        credentials: compacted.credentials
      }
      if (compacted.changed) {
        void this.enqueuePersistSnapshot().catch((error) => {
          console.warn('[OpenAICodex][CredentialStore] Failed to persist compacted snapshot', error)
        })
      }
    }
    return state.snapshot
  }

  private enqueuePersistSnapshot(): Promise<void> {
    const state = this.getState()
    const snapshot = cloneSnapshot(this.ensureLoaded())
    state.writeQueue = state.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeSnapshot(this.filePath, snapshot)
      })
    return state.writeQueue
  }

  async getActive(
    tenantId: string,
    providerId: OpenAIProviderId,
    accountId?: string
  ): Promise<OpenAICodexCredential | null> {
    const snapshot = this.ensureLoaded()
    for (let i = snapshot.credentials.length - 1; i >= 0; i -= 1) {
      const credential = snapshot.credentials[i]
      if (credential.tenantId !== tenantId) continue
      if (credential.providerId !== providerId) continue
      if ((credential.accountId || undefined) !== (accountId || undefined)) continue
      if (!isActive(credential)) continue
      return credential
    }

    if (accountId) {
      return null
    }

    const candidates = snapshot.credentials.filter(credential => {
      if (credential.tenantId !== tenantId) return false
      if (credential.providerId !== providerId) return false
      return isActive(credential)
    })
    if (candidates.length === 0) {
      return null
    }
    return pickLatestActiveCredential(candidates)
  }

  async upsert(credential: OpenAICodexCredential): Promise<void> {
    const snapshot = this.ensureLoaded()
    const compositeKey = toCompositeKey(credential.tenantId, credential.providerId, credential.accountId || undefined)
    const next = snapshot.credentials.filter(existing => {
      if (existing.id === credential.id) return false
      const existingCompositeKey = toCompositeKey(
        existing.tenantId,
        existing.providerId,
        existing.accountId || undefined
      )
      return existingCompositeKey !== compositeKey
    })
    next.push(credential)
    snapshot.credentials = next
    await this.enqueuePersistSnapshot()
  }

  async markRevoked(credentialId: string, _reason: string): Promise<void> {
    const snapshot = this.ensureLoaded()
    const next = snapshot.credentials.map(credential => {
      if (credential.id !== credentialId) return credential
      return {
        ...credential,
        revokedAt: Date.now()
      }
    })
    snapshot.credentials = next
    await this.enqueuePersistSnapshot()
  }
}
