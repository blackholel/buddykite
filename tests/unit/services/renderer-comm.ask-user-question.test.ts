import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionState } from '../../../src/main/services/agent/types'

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    permissions: {
      commandExecution: 'allow',
      trustMode: true
    }
  }))
}))

vi.mock('../../../src/main/services/ai-browser', () => ({
  isAIBrowserTool: vi.fn((toolName: string) => toolName.startsWith('browser_'))
}))

vi.mock('../../../src/main/http/websocket', () => ({
  broadcastToWebSocket: vi.fn()
}))

vi.mock('../../../src/main/services/agent/space-resource-policy.service', () => ({
  getSpaceResourcePolicy: vi.fn(() => ({
    version: 1,
    mode: 'strict-space-only'
  })),
  isStrictSpaceOnlyPolicy: vi.fn((policy: { mode: string }) => policy.mode === 'strict-space-only')
}))

import {
  createCanUseTool,
  normalizeAskUserQuestionInput
} from '../../../src/main/services/agent/renderer-comm'

function createSession(mode: 'plan' | 'code' | 'ask' = 'plan'): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId: 'conversation-1',
    runId: 'run-1',
    mode,
    startedAt: Date.now(),
    latestAssistantContent: '',
    lifecycle: 'running',
    terminalReason: null,
    terminalAt: null,
    finalized: false,
    toolCallSeq: 0,
    toolsById: new Map(),
    askUserQuestionModeByToolCallId: new Map(),
    pendingPermissionResolve: null,
    pendingAskUserQuestionsById: new Map(),
    pendingAskUserQuestionOrder: [],
    pendingAskUserQuestionIdByToolCallId: new Map(),
    unmatchedAskUserQuestionToolCalls: new Map(),
    askUserQuestionSeq: 0,
    recentlyResolvedAskUserQuestionByToolCallId: new Map(),
    askUserQuestionUsedInRun: false,
    textClarificationFallbackUsedInConversation: false,
    textClarificationDetectedInRun: false,
    thoughts: [],
    processTrace: []
  }
}

function createPlanHandler(session: SessionState) {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => session,
    { mode: 'plan' }
  )
}

describe('renderer-comm AskUserQuestion priority + plan whitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('plan mode allows read-only tools and blocks write/execute/browser tools', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)
    const signal = { signal: new AbortController().signal }

    await expect(canUseTool('Read', { file_path: 'README.md' }, signal)).resolves.toMatchObject({
      behavior: 'allow'
    })
    await expect(canUseTool('Grep', { pattern: 'TODO', path: '.' }, signal)).resolves.toMatchObject({
      behavior: 'allow'
    })
    await expect(canUseTool('Glob', { pattern: '**/*.ts' }, signal)).resolves.toMatchObject({
      behavior: 'allow'
    })

    const deniedWrite = await canUseTool('Write', { file_path: 'README.md', content: 'x' }, signal)
    expect(deniedWrite.behavior).toBe('deny')
    expect(deniedWrite.message).toContain('PLAN mode only allows')

    const deniedBash = await canUseTool('Bash', { command: 'echo hello' }, signal)
    expect(deniedBash.behavior).toBe('deny')
    expect(deniedBash.message).toContain('PLAN mode only allows')

    const deniedBrowser = await canUseTool('browser_navigate', { url: 'https://example.com' }, signal)
    expect(deniedBrowser.behavior).toBe('deny')
    expect(deniedBrowser.message).toContain('PLAN mode only allows')
  })

  it('plan mode task is allowed with exploration-only prompt guard', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)
    const decision = await canUseTool(
      'Task',
      {
        description: 'Inspect relevant modules',
        prompt: 'Find how mode switching works.'
      },
      { signal: new AbortController().signal }
    )

    expect(decision.behavior).toBe('allow')
    expect(decision.updatedInput).toBeDefined()
    expect(typeof decision.updatedInput?.prompt).toBe('string')
    expect(String(decision.updatedInput?.prompt)).toContain('PLAN MODE sub-agent policy')
    expect(String(decision.updatedInput?.prompt)).toContain('Find how mode switching works.')
    expect(decision.updatedInput?.subagent_type).toBe('explorer')
  })

  it('plan mode AskUserQuestion creates pending context and resolves via updated input path', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)

    const pendingDecisionPromise = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            id: 'q_1',
            question: 'Which mode do you prefer?',
            options: [{ label: 'Plan', description: 'Keep plan mode' }]
          }
        ]
      },
      { signal: new AbortController().signal }
    )

    await Promise.resolve()
    expect(session.askUserQuestionUsedInRun).toBe(true)
    expect(session.pendingAskUserQuestionOrder.length).toBe(1)

    const pendingId = session.pendingAskUserQuestionOrder[0]
    const pendingContext = session.pendingAskUserQuestionsById.get(pendingId)
    expect(pendingContext).toBeTruthy()
    pendingContext?.resolve({ behavior: 'allow', updatedInput: { answers: { q_1: 'Plan' } } })

    const decision = await pendingDecisionPromise
    expect(decision.behavior).toBe('allow')
    expect(decision.updatedInput).toEqual({ answers: { q_1: 'Plan' } })
  })
})

describe('normalizeAskUserQuestionInput multiSelect precedence', () => {
  it('defaults to multi-select for multi-question payload when not explicitly set', () => {
    const normalized = normalizeAskUserQuestionInput({
      questions: [
        { id: 'q_1', question: 'Question 1', options: ['A', 'B'] },
        { id: 'q_2', question: 'Question 2', options: ['C', 'D'] }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions).toHaveLength(2)
    expect(questions.every((q) => q.multiSelect === true)).toBe(true)
  })

  it('keeps single question as single-select when not explicitly set', () => {
    const normalized = normalizeAskUserQuestionInput({
      questions: [{ id: 'q_1', question: 'Only one', options: ['A', 'B'] }]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions).toHaveLength(1)
    expect(questions[0].multiSelect).toBe(false)
  })

  it('applies top-level multiSelect to questions without explicit field', () => {
    const normalized = normalizeAskUserQuestionInput({
      multi_select: false,
      questions: [
        { id: 'q_1', question: 'Question 1', options: ['A', 'B'] },
        { id: 'q_2', question: 'Question 2', options: ['C', 'D'] }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions.every((q) => q.multiSelect === false)).toBe(true)
  })

  it('preserves explicit question-level false over top-level and inferred defaults', () => {
    const normalized = normalizeAskUserQuestionInput({
      multiSelect: true,
      questions: [
        { id: 'q_1', question: 'Question 1', options: ['A', 'B'], multiSelect: false },
        { id: 'q_2', question: 'Question 2', options: ['C', 'D'] }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions[0].multiSelect).toBe(false)
    expect(questions[1].multiSelect).toBe(true)
  })
})
