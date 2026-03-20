import { describe, expect, it } from 'vitest'

import {
  forceChromeDevtoolsUseBrowserUrl,
  parseLocalDebugPortFromBrowserUrl,
  resolveChromeDevtoolsDebugTarget
} from '../../../src/main/services/chrome-debug-launcher.service'

describe('chrome-debug-launcher.service', () => {
  it('autoConnect 模式默认使用 9222', () => {
    const target = resolveChromeDevtoolsDebugTarget({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect']
        }
      }
    })

    expect(target).toEqual({ port: 9222 })
  })

  it('browser-url 指向 localhost 时使用显式端口', () => {
    const target = resolveChromeDevtoolsDebugTarget({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9333']
        }
      }
    })

    expect(target).toEqual({ port: 9333 })
  })

  it('ws-endpoint 模式不触发本地 Chrome 拉起', () => {
    const target = resolveChromeDevtoolsDebugTarget({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--ws-endpoint=ws://127.0.0.1:9222/devtools/browser/abc']
        }
      }
    })

    expect(target).toBeNull()
  })

  it('非本地 browser-url 不触发本地 Chrome 拉起', () => {
    const target = resolveChromeDevtoolsDebugTarget({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url=https://example.com:9222']
        }
      }
    })

    expect(target).toBeNull()
  })

  it('禁用的 server 不触发自动拉起', () => {
    const target = resolveChromeDevtoolsDebugTarget({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'],
          disabled: true
        }
      }
    })

    expect(target).toBeNull()
  })

  it('browser-url 解析支持省略协议和 localhost', () => {
    expect(parseLocalDebugPortFromBrowserUrl('localhost:9444')).toBe(9444)
  })

  it('browser-url 解析支持 IPv6 localhost', () => {
    expect(parseLocalDebugPortFromBrowserUrl('http://[::1]:9555')).toBe(9555)
  })

  it('会把 autoConnect 运行时改写为 browser-url 直连', () => {
    const prepared = forceChromeDevtoolsUseBrowserUrl({
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect']
        }
      }
    })

    const args = ((prepared.mcpServers as any)['chrome-devtools']?.args || []) as string[]
    expect(args).toContain('--browser-url=http://127.0.0.1:9222')
    expect(args).not.toContain('--autoConnect')
  })

  it('如果显式 ws-endpoint，则不改写为 browser-url', () => {
    const raw = {
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--ws-endpoint=ws://127.0.0.1:9222/devtools/browser/abc']
        }
      }
    }
    const prepared = forceChromeDevtoolsUseBrowserUrl(raw)

    expect(prepared).toBe(raw)
  })
})
