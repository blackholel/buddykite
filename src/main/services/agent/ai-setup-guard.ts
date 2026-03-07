import { getAiSetupState, type AiSetupConfigInput } from '../../../shared/types/ai-profile'

export function createAiProfileNotConfiguredError(
  message = 'Please configure AI profile first'
): Error & { errorCode: string } {
  const error = new Error(message) as Error & { errorCode: string }
  error.errorCode = 'AI_PROFILE_NOT_CONFIGURED'
  return error
}

export function assertAiProfileConfigured(
  config: AiSetupConfigInput | null | undefined,
  profileId?: string | null
): void {
  const aiSetupState = getAiSetupState(config, profileId)
  if (!aiSetupState.configured) {
    console.warn('[AISetupGuard] profile not configured', {
      profileId: profileId || null,
      reason: aiSetupState.reason,
      defaultProfileId: config?.ai?.defaultProfileId ?? null
    })
    throw createAiProfileNotConfiguredError()
  }
}
