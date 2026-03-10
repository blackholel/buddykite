import { beforeEach, describe, expect, it, vi } from 'vitest'

const listSkillsMock = vi.fn()
const getSkillContentMock = vi.fn()

vi.mock('../../../src/main/services/skills.service', () => ({
  listSkills: (...args: unknown[]) => listSkillsMock(...args),
  getSkillContent: (...args: unknown[]) => getSkillContentMock(...args)
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: vi.fn((
    name: string,
    _description: string,
    _schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => ({ name, handler })),
  createSdkMcpServer: vi.fn((input: Record<string, unknown>) => input)
}))

import {
  createSkillsMcpServer,
  getSkillsMcpServerMetrics,
  resetSkillsMcpServerState
} from '../../../src/main/services/skills-mcp-server'

function getToolHandler(
  server: { tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> },
  name: string
): (args: Record<string, unknown>) => Promise<unknown> {
  const target = server.tools.find((tool) => tool.name === name)
  if (!target) {
    throw new Error(`tool not found: ${name}`)
  }
  return target.handler
}

describe('skills-mcp-server resilience', () => {
  const telemetrySpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    resetSkillsMcpServerState()
  })

  it('skills_list 命中缓存后不重复查询底层服务', async () => {
    listSkillsMock.mockReturnValue([
      { name: 'coding-standards', description: 'desc' }
    ])

    const server = createSkillsMcpServer('/workspace/project') as {
      tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>
    }
    const listHandler = getToolHandler(server, 'skills_list')

    await listHandler({ query: 'coding', limit: 10 })
    await listHandler({ query: 'coding', limit: 10 })

    expect(listSkillsMock).toHaveBeenCalledTimes(1)
    expect(getSkillsMcpServerMetrics().cacheHitRate).toBeGreaterThan(0)
  })

  it('查询失败时回退 stale 缓存', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-09T10:00:00.000Z'))

    listSkillsMock.mockReturnValue([
      { name: 'tdd-workflow', description: 'desc' }
    ])

    const server = createSkillsMcpServer('/workspace/project') as {
      tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>
    }
    const listHandler = getToolHandler(server, 'skills_list')

    await listHandler({ query: 'tdd', limit: 10 })

    vi.setSystemTime(new Date('2026-03-09T10:01:01.000Z')) // 超过 60s fresh TTL
    listSkillsMock.mockImplementation(() => {
      throw new Error('upstream unavailable')
    })

    const result = await listHandler({ query: 'tdd', limit: 10 }) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toContain('[stale-cache-fallback]')
    expect(getSkillsMcpServerMetrics().staleFallbackHitCount).toBe(1)
    expect(telemetrySpy).toHaveBeenCalledWith(
      '[telemetry] skills_mcp_server',
      expect.objectContaining({
        kind: 'stale_fallback'
      })
    )
  })

  it('连续失败达到阈值后开启熔断并快速失败', async () => {
    listSkillsMock.mockImplementation(() => {
      throw new Error('query failed')
    })

    const server = createSkillsMcpServer('/workspace/project') as {
      tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>
    }
    const listHandler = getToolHandler(server, 'skills_list')

    for (let i = 0; i < 5; i += 1) {
      await expect(listHandler({ query: `q-${i}`, limit: 5 })).rejects.toBeTruthy()
    }

    await expect(listHandler({ query: 'q-open', limit: 5 })).rejects.toMatchObject({
      errorCode: 'SKILLS_QUERY_CIRCUIT_OPEN'
    })
    expect(listSkillsMock).toHaveBeenCalledTimes(5)
    expect(getSkillsMcpServerMetrics().circuitOpenCount).toBeGreaterThan(0)
    expect(telemetrySpy).toHaveBeenCalledWith(
      '[telemetry] skills_mcp_server',
      expect.objectContaining({
        kind: 'circuit_open'
      })
    )
  })
})
