import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({ claudeCode: {} })),
  getTempSpacePath: vi.fn(() => '/tmp/kite-temp')
}))

vi.mock('../../../src/main/services/agent/renderer-comm', () => ({
  getMainWindow: vi.fn(() => null),
  setMainWindow: vi.fn()
}))

vi.mock('../../../src/main/http/websocket', () => ({
  broadcastToAll: vi.fn()
}))

vi.mock('../../../src/main/services/agent/electron-path', () => ({
  getHeadlessElectronPath: vi.fn(() => '/tmp/electron')
}))

vi.mock('../../../src/main/services/agent/provider-resolver', () => ({
  resolveProvider: vi.fn(async () => ({
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://api.anthropic.com',
    sdkModel: 'claude-sonnet',
    effectiveModel: 'claude-sonnet',
    protocol: 'anthropic_official',
    vendor: 'anthropic',
    useAnthropicCompatModelMapping: false
  })),
  shouldEnableAnthropicCompatEnvDefaults: vi.fn(() => false),
  buildAnthropicCompatEnvDefaults: vi.fn(() => ({}))
}))

vi.mock('../../../src/main/services/agent/ai-config-resolver', () => ({
  resolveEffectiveConversationAi: vi.fn(() => ({
    profile: { apiKey: 'test-key' },
    effectiveModel: 'claude-sonnet'
  }))
}))

vi.mock('../../../src/main/services/agent/sdk-config.builder', () => ({
  getEnabledMcpServers: vi.fn(() => ({
    'chrome-devtools': {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9222']
    }
  }))
}))

vi.mock('../../../src/main/services/chrome-debug-launcher.service', () => ({
  forceChromeDevtoolsUseBrowserUrl: vi.fn((options) => options),
  ensureChromeDebugModeReadyForMcp: vi.fn().mockResolvedValue(undefined)
}))

import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import {
  ensureChromeDebugModeReadyForMcp,
  forceChromeDevtoolsUseBrowserUrl
} from '../../../src/main/services/chrome-debug-launcher.service'
import { testMcpConnections } from '../../../src/main/services/agent/mcp-status.service'

function createAsyncIterator(messages: Array<Record<string, unknown>>) {
  return (async function * () {
    for (const message of messages) {
      yield message
    }
  })()
}

describe('mcp-status.service testMcpConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is passive and does not prewarm Chrome debug endpoint', async () => {
    vi.mocked(claudeQuery).mockReturnValue(
      createAsyncIterator([
        {
          type: 'system',
          mcp_servers: [
            { name: 'chrome-devtools', status: 'failed' },
            { name: 'demo', status: 'connected' }
          ]
        }
      ]) as any
    )

    const result = await testMcpConnections()

    expect(result.success).toBe(true)
    expect(result.servers).toEqual([
      { name: 'chrome-devtools', status: 'failed' },
      { name: 'demo', status: 'connected' }
    ])
    expect(forceChromeDevtoolsUseBrowserUrl).toHaveBeenCalledTimes(1)
    expect(ensureChromeDebugModeReadyForMcp).not.toHaveBeenCalled()
    expect(claudeQuery).toHaveBeenCalledTimes(1)
  })
})
