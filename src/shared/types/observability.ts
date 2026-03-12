/**
 * Shared observability configuration types.
 */

export type LangfuseMaskMode = 'summary_hash' | 'off'

export interface LangfuseObservabilityConfig {
  enabled: boolean
  host: string
  publicKey: string
  secretKey: string
  sampleRate: number
  maskMode: LangfuseMaskMode
  devApiEnabled: boolean
}

export interface ObservabilityConfig {
  langfuse: LangfuseObservabilityConfig
}
