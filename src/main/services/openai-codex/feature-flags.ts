export interface OpenAICodexFlags {
  enabled: boolean
  experiment: boolean
  killed: boolean
  active: boolean
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

export function resolveOpenAICodexFlags(env: NodeJS.ProcessEnv = process.env): OpenAICodexFlags {
  const enabled = isTruthy(env.PROVIDER_OPENAI_CODEX_ENABLED)
  const experiment = isTruthy(env.PROVIDER_OPENAI_CODEX_EXPERIMENT)
  const killed = isTruthy(env.CODEX_KILL_SWITCH)
  const active = enabled && experiment && !killed

  return {
    enabled,
    experiment,
    killed,
    active
  }
}
