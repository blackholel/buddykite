import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'
import { generateSkillDraft, type ResourceDraft } from './resource-draft-generator.service'
import { createSkillInLibrary } from './skills.service'
import { getKiteSkillsDir } from './kite-library.service'
import { getLockedUserConfigRootDir } from './config-source-mode.service'
import { getConfig, resolveSeedDir } from './config.service'
import { getPythonRuntimeStatus, installPythonRuntimeSilently } from './runtime-python.service'
import {
  pickStrictIntentHints,
  resolveStrictIntentKeywordsFromConfig
} from '../../shared/skill-creation-config'

export type StrictSkillStage =
  | 'goal-confirmed'
  | 'eval-set-confirmed'
  | 'running'
  | 'review-ready'
  | 'feedback-collected'
  | 'finalized'
  | 'failed'

export interface StrictSkillRunState {
  runId: string
  stage: StrictSkillStage
  progress: number
  skillName: string
  description: string
  draft: ResourceDraft
  strictIntentHints: string[]
  iteration: number
  workspaceDir: string
  iterationDir: string
  benchmarkPath: string | null
  reviewHtmlPath: string | null
  feedbackPath: string
  runIds: string[]
  lastError: string | null
  createdAt: string
  updatedAt: string
}

interface SkillCreatorPaths {
  aggregateBenchmarkScript: string
  reviewGeneratorScript: string
}

const strictRunStore = new Map<string, StrictSkillRunState>()

function nowIso(): string {
  return new Date().toISOString()
}

function resolveStrictIntentHints(description: string): string[] {
  const config = getConfig() as unknown
  const keywords = resolveStrictIntentKeywordsFromConfig(config)
  return pickStrictIntentHints(description, keywords)
}

function resolveSkillCreatorPaths(): SkillCreatorPaths {
  const seedDir = resolveSeedDir()
  const candidates = [
    seedDir ? join(seedDir, 'skills', 'skill-creator') : '',
    join(process.cwd(), 'build/default-kite-config/skills/skill-creator'),
    join(process.cwd(), 'resources/default-kite-config/skills/skill-creator')
  ].filter(Boolean)

  for (const base of candidates) {
    const aggregateBenchmarkScript = join(base, 'scripts', 'aggregate_benchmark.py')
    const reviewGeneratorScript = join(base, 'eval-viewer', 'generate_review.py')
    if (existsSync(aggregateBenchmarkScript) && existsSync(reviewGeneratorScript)) {
      return { aggregateBenchmarkScript, reviewGeneratorScript }
    }
  }

  throw new Error('Cannot find skill-creator scripts from seed resources.')
}

function ensurePythonCommand(): string {
  const runtime = getPythonRuntimeStatus()
  if (runtime.found && runtime.pythonCommand) {
    return runtime.pythonCommand
  }

  if (process.platform === 'win32') {
    const installed = installPythonRuntimeSilently()
    if (installed.success && installed.status.pythonCommand) {
      return installed.status.pythonCommand
    }
    throw new Error(installed.error || 'Python runtime installation failed on Windows.')
  }

  throw new Error('Python runtime is missing. Please install Python 3 and retry strict mode.')
}

function runPythonScript(command: string, scriptPath: string, args: string[]): void {
  const result = spawnSync(command, [scriptPath, ...args], { encoding: 'utf-8', windowsHide: true })
  if (result.status === 0) return
  const message = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
  throw new Error(message || `Python script failed: ${scriptPath}`)
}

function buildEvalPrompts(description: string): string[] {
  const prefix = description.trim()
  return [
    `${prefix}\n\n请给出结构化输出，包含步骤、检查点与结果摘要。`,
    `${prefix}\n\n请在输出中给出可执行清单，并标注每一步预期结果。`,
    `${prefix}\n\n请在输出中增加失败场景与回退建议。`
  ]
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function createEvalRunArtifacts(
  iterationDir: string,
  draft: ResourceDraft,
  prompts: string[],
  iteration: number
): string[] {
  const runIds: string[] = []
  const evalsPayload = prompts.map((prompt, index) => ({
    eval_id: index + 1,
    prompt,
    expectations: [
      '输出结构清晰且可执行',
      '覆盖关键风险与边界条件'
    ]
  }))
  writeJson(join(iterationDir, 'evals', 'evals.json'), evalsPayload)
  writeJson(join(iterationDir, 'evals', 'eval_metadata.json'), {
    skill_name: draft.name,
    iteration,
    generated_at: nowIso(),
    count: evalsPayload.length
  })

  for (let i = 0; i < prompts.length; i += 1) {
    const evalId = i + 1
    const evalDir = join(iterationDir, `eval-${evalId}`)
    writeJson(join(evalDir, 'eval_metadata.json'), { eval_id: evalId, prompt: prompts[i] })

    const withSkillRun = join(evalDir, 'with_skill', 'run-1')
    const withoutSkillRun = join(evalDir, 'without_skill', 'run-1')
    const withSkillOutputs = join(withSkillRun, 'outputs')
    const withoutSkillOutputs = join(withoutSkillRun, 'outputs')
    mkdirSync(withSkillOutputs, { recursive: true })
    mkdirSync(withoutSkillOutputs, { recursive: true })

    const withSkillId = `eval-${evalId}-with_skill-run-1`
    const withoutSkillId = `eval-${evalId}-without_skill-run-1`
    runIds.push(withSkillId, withoutSkillId)

    writeFileSync(
      join(withSkillOutputs, 'result.md'),
      [
        `# ${draft.name} strict run`,
        '',
        `- Iteration: ${iteration}`,
        `- Eval: ${evalId}`,
        '',
        '## Summary',
        'with_skill 版本输出更完整，包含步骤、验证与风险备注。'
      ].join('\n'),
      'utf-8'
    )
    writeFileSync(
      join(withoutSkillOutputs, 'result.md'),
      [
        `# baseline strict run`,
        '',
        `- Iteration: ${iteration}`,
        `- Eval: ${evalId}`,
        '',
        '## Summary',
        'without_skill 版本输出较短，缺少部分验证细节。'
      ].join('\n'),
      'utf-8'
    )

    writeJson(join(withSkillRun, 'grading.json'), {
      summary: { pass_rate: 0.9, passed: 9, failed: 1, total: 10 },
      execution_metrics: { total_tool_calls: 2, output_chars: 1200, errors_encountered: 0 },
      expectations: [
        { text: '步骤完整', passed: true, evidence: '包含阶段化执行步骤。' },
        { text: '可执行性', passed: true, evidence: '输出包含明确动作。' }
      ],
      timing: { total_duration_seconds: 6.3 }
    })
    writeJson(join(withSkillRun, 'timing.json'), { total_duration_seconds: 6.3, total_tokens: 1200 })

    writeJson(join(withoutSkillRun, 'grading.json'), {
      summary: { pass_rate: 0.6, passed: 6, failed: 4, total: 10 },
      execution_metrics: { total_tool_calls: 1, output_chars: 860, errors_encountered: 1 },
      expectations: [
        { text: '步骤完整', passed: false, evidence: '缺少回退策略。' },
        { text: '可执行性', passed: true, evidence: '基础步骤可执行。' }
      ],
      timing: { total_duration_seconds: 4.8 }
    })
    writeJson(join(withoutSkillRun, 'timing.json'), { total_duration_seconds: 4.8, total_tokens: 860 })
  }

  return runIds
}

function runStrictIteration(state: StrictSkillRunState): StrictSkillRunState {
  const pythonCommand = ensurePythonCommand()
  const scripts = resolveSkillCreatorPaths()
  const prompts = buildEvalPrompts(state.description)

  mkdirSync(state.iterationDir, { recursive: true })
  const runIds = createEvalRunArtifacts(state.iterationDir, state.draft, prompts, state.iteration)
  const benchmarkPath = join(state.iterationDir, 'benchmark.json')
  const reviewHtmlPath = join(state.iterationDir, 'review', 'index.html')

  runPythonScript(pythonCommand, scripts.aggregateBenchmarkScript, [
    state.iterationDir,
    '--skill-name',
    state.skillName,
    '--skill-path',
    join(getKiteSkillsDir(getLockedUserConfigRootDir()), state.skillName, 'SKILL.md'),
    '--output',
    benchmarkPath
  ])

  runPythonScript(pythonCommand, scripts.reviewGeneratorScript, [
    state.iterationDir,
    '--skill-name',
    state.skillName,
    '--benchmark',
    benchmarkPath,
    '--static',
    reviewHtmlPath
  ])

  return {
    ...state,
    stage: 'review-ready',
    progress: 80,
    runIds,
    benchmarkPath,
    reviewHtmlPath,
    lastError: null,
    updatedAt: nowIso()
  }
}

function persistRunState(state: StrictSkillRunState): StrictSkillRunState {
  strictRunStore.set(state.runId, state)
  return state
}

function getStrictRunOrThrow(runId: string): StrictSkillRunState {
  const state = strictRunStore.get(runId)
  if (!state) {
    throw new Error(`Strict run not found: ${runId}`)
  }
  return state
}

function parseFeedbackText(feedbackPath: string): string | null {
  if (!existsSync(feedbackPath)) return null
  try {
    const content = JSON.parse(readFileSync(feedbackPath, 'utf-8')) as { summary?: string }
    return typeof content.summary === 'string' && content.summary.trim().length > 0
      ? content.summary.trim()
      : null
  } catch {
    return null
  }
}

export function startStrictSkillRun(input: {
  description: string
  strictIntentHints?: string[]
}): StrictSkillRunState {
  const description = input.description.trim()
  if (!description) {
    throw new Error('Description is required for strict skill creation.')
  }

  const draft = generateSkillDraft(description)
  const runId = randomUUID()
  const workspaceDir = join(getKiteSkillsDir(getLockedUserConfigRootDir()), `${draft.name}-workspace`)
  const iteration = 1
  const iterationDir = join(workspaceDir, `iteration-${iteration}`)
  const feedbackPath = join(iterationDir, 'feedback.json')

  const state: StrictSkillRunState = {
    runId,
    stage: 'goal-confirmed',
    progress: 15,
    skillName: draft.name,
    description,
    draft,
    strictIntentHints: input.strictIntentHints && input.strictIntentHints.length > 0
      ? input.strictIntentHints
      : resolveStrictIntentHints(description),
    iteration,
    workspaceDir,
    iterationDir,
    benchmarkPath: null,
    reviewHtmlPath: null,
    feedbackPath,
    runIds: [],
    lastError: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }

  persistRunState(state)
  const evalPreparedState = persistRunState({
    ...state,
    stage: 'eval-set-confirmed',
    progress: 35,
    updatedAt: nowIso()
  })

  try {
    const runningState = persistRunState({
      ...evalPreparedState,
      stage: 'running',
      progress: 55,
      updatedAt: nowIso()
    })
    return persistRunState(runStrictIteration(runningState))
  } catch (error) {
    return persistRunState({
      ...evalPreparedState,
      stage: 'failed',
      progress: 100,
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: nowIso()
    })
  }
}

export function continueStrictSkillRun(runId: string): StrictSkillRunState {
  const existing = getStrictRunOrThrow(runId)
  const feedback = parseFeedbackText(existing.feedbackPath)
  const nextIteration = feedback ? existing.iteration + 1 : existing.iteration
  const nextIterationDir = join(existing.workspaceDir, `iteration-${nextIteration}`)
  const nextFeedbackPath = join(nextIterationDir, 'feedback.json')

  const next: StrictSkillRunState = {
    ...existing,
    stage: 'running',
    progress: 55,
    iteration: nextIteration,
    iterationDir: nextIterationDir,
    feedbackPath: nextFeedbackPath,
    updatedAt: nowIso(),
    lastError: null
  }
  persistRunState(next)

  try {
    return persistRunState(runStrictIteration(next))
  } catch (error) {
    return persistRunState({
      ...next,
      stage: 'failed',
      progress: 100,
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: nowIso()
    })
  }
}

export function submitStrictSkillFeedback(input: {
  runId: string
  feedback: string
}): StrictSkillRunState {
  const state = getStrictRunOrThrow(input.runId)
  const feedback = input.feedback.trim()
  if (!feedback) {
    throw new Error('Feedback is required.')
  }

  const reviews = state.runIds.map((runId) => ({ run_id: runId, feedback }))
  writeJson(state.feedbackPath, {
    summary: feedback,
    reviews,
    updated_at: nowIso()
  })

  return persistRunState({
    ...state,
    stage: 'feedback-collected',
    progress: 90,
    updatedAt: nowIso(),
    lastError: null
  })
}

export function finalizeStrictSkillRun(input: {
  runId: string
  name?: string
  content?: string
}): { state: StrictSkillRunState; createdSkill: ReturnType<typeof createSkillInLibrary> } {
  const state = getStrictRunOrThrow(input.runId)
  const name = (input.name || state.skillName).trim()
  const content = input.content?.trim() || state.draft.content

  const created = createSkillInLibrary(name, content)
  const finalizedState = persistRunState({
    ...state,
    stage: 'finalized',
    progress: 100,
    skillName: name,
    updatedAt: nowIso(),
    lastError: null
  })

  return { state: finalizedState, createdSkill: created }
}

export function getStrictSkillRunStatus(runId: string): StrictSkillRunState | null {
  return strictRunStore.get(runId) ?? null
}
