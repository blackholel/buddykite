import { describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
  tool: vi.fn((name: string, description: string, input: unknown, handler: unknown) => ({
    name,
    description,
    input,
    handler
  })),
  createSdkMcpServer: vi.fn((config: Record<string, unknown>) => config)
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: sdkMocks.tool,
  createSdkMcpServer: sdkMocks.createSdkMcpServer
}))

import { createWidgetMcpServer, WIDGET_SYSTEM_PROMPT } from '../../../src/main/services/agent/widget-guidelines'

describe('widget-guidelines', () => {
  it('WIDGET_SYSTEM_PROMPT 包含 show-widget 合约和加载指引', () => {
    expect(WIDGET_SYSTEM_PROMPT).toContain('show-widget')
    expect(WIDGET_SYSTEM_PROMPT).toContain('codepilot_load_widget_guidelines')
    expect(WIDGET_SYSTEM_PROMPT).toContain('Do not use other fence tags')
  })

  it('createWidgetMcpServer 挂载 codepilot-widget 与 guidelines 工具', () => {
    const server = createWidgetMcpServer() as {
      name: string
      version: string
      tools: Array<{ name: string }>
    }

    expect(server.name).toBe('codepilot-widget')
    expect(server.version).toBe('1.0.0')
    expect(server.tools).toHaveLength(1)
    expect(server.tools[0].name).toBe('codepilot_load_widget_guidelines')
    expect(sdkMocks.createSdkMcpServer).toHaveBeenCalledTimes(1)
  })

  it('guidelines 工具返回包含 schema 要求与示例', async () => {
    const server = createWidgetMcpServer() as {
      tools: Array<{ handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> }>
    }
    const result = await server.tools[0].handler({})
    const text = result.content[0]?.text || ''

    expect(result.content[0]?.type).toBe('text')
    expect(text).toContain('Required output contract')
    expect(text).toContain('show-widget')
    expect(text).toContain('"widget_code"')
  })
})
