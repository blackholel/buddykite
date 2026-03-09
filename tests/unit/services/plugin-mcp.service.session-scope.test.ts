import { describe, expect, it } from 'vitest'
import { buildSessionKey } from '../../../src/shared/session-key'
import {
  clearEnabledPluginMcps,
  enablePluginMcp,
  getEnabledPluginMcpList
} from '../../../src/main/services/plugin-mcp.service'

describe('plugin-mcp.service session scope isolation', () => {
  it('same conversationId across spaces stays isolated by sessionKey', () => {
    const sessionA = buildSessionKey('space-a', 'conv-shared')
    const sessionB = buildSessionKey('space-b', 'conv-shared')

    clearEnabledPluginMcps(sessionA)
    clearEnabledPluginMcps(sessionB)

    enablePluginMcp(sessionA, 'vendor/plugin-a')

    expect(getEnabledPluginMcpList(sessionA)).toEqual(['vendor/plugin-a'])
    expect(getEnabledPluginMcpList(sessionB)).toEqual([])
  })
})
