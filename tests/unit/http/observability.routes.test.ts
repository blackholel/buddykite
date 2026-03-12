import express from 'express'
import { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerApiRoutes } from '../../../src/main/http/routes'
import { saveConfig } from '../../../src/main/services/config.service'
import {
  _testOnly,
  finalizeAgentRunObservation,
  startAgentRunObservation
} from '../../../src/main/services/observability'

function setInternalApiEnabled(enabled: boolean): void {
  saveConfig({
    observability: {
      langfuse: {
        enabled,
        devApiEnabled: enabled,
        publicKey: '',
        secretKey: ''
      }
    }
  } as any)
}

describe('Internal observability routes', () => {
  let server: ReturnType<express.Express['listen']> | null = null
  let baseUrl = ''

  beforeEach(async () => {
    _testOnly().reset()
    setInternalApiEnabled(true)

    const app = express()
    app.use(express.json())
    app.use('/api', (_req, _res, next) => next())
    registerApiRoutes(app, null)

    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve()
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    server = null
    baseUrl = ''
  })

  it('可以查询 runs 列表与详情', async () => {
    const handle = startAgentRunObservation({
      sessionKey: 'space-a:conv-a',
      spaceId: 'space-a',
      conversationId: 'conv-a',
      runId: 'run-route-test',
      mode: 'code',
      message: 'hello',
      responseLanguage: 'zh-CN',
      imageCount: 0,
      fileContextCount: 0,
      aiBrowserEnabled: false,
      thinkingEnabled: false
    })
    finalizeAgentRunObservation(handle, {
      status: 'completed',
      terminalReason: 'completed',
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
      finalContent: 'ok'
    })

    const listResp = await fetch(`${baseUrl}/api/internal/observability/runs?limit=20`)
    expect(listResp.status).toBe(200)
    const listPayload = await listResp.json() as {
      success: boolean
      data?: { runs: Array<{ runId: string }> }
    }
    expect(listPayload.success).toBe(true)
    expect(listPayload.data?.runs.some((run) => run.runId === 'run-route-test')).toBe(true)

    const detailResp = await fetch(`${baseUrl}/api/internal/observability/runs/run-route-test`)
    expect(detailResp.status).toBe(200)
    const detailPayload = await detailResp.json() as { success: boolean; data?: { runId: string } }
    expect(detailPayload.success).toBe(true)
    expect(detailPayload.data?.runId).toBe('run-route-test')
  })

  it('当内部开关关闭时应返回 404', async () => {
    setInternalApiEnabled(false)

    const resp = await fetch(`${baseUrl}/api/internal/observability/runs`)
    expect(resp.status).toBe(404)
  })

  it('toggle 关闭后应立即失效', async () => {
    const toggleResp = await fetch(`${baseUrl}/api/internal/observability/toggle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ enabled: false, devApiEnabled: false })
    })

    expect(toggleResp.status).toBe(200)

    const listResp = await fetch(`${baseUrl}/api/internal/observability/runs`)
    expect(listResp.status).toBe(404)
  })
})
