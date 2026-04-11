import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { ApiProfile } from '../../../src/renderer/types'
import {
  ensureTemplateProfiles,
  getFirstMissingTemplateKey,
  resolveTemplateKeyFromProfile
} from '../../../src/renderer/pages/SettingsPage'
import { AI_PROFILE_TEMPLATES } from '../../../src/renderer/components/settings/aiProfileDomain'

const settingsPageFile = path.resolve(__dirname, '../../../src/renderer/pages/SettingsPage.tsx')

function createProfile(overrides: Partial<ApiProfile>): ApiProfile {
  return {
    id: overrides.id || 'profile-id',
    name: overrides.name || 'Profile',
    vendor: overrides.vendor || 'anthropic',
    protocol: overrides.protocol || 'anthropic_official',
    presetKey: overrides.presetKey,
    apiUrl: overrides.apiUrl || 'https://api.anthropic.com',
    apiKey: overrides.apiKey || '',
    defaultModel: overrides.defaultModel || 'claude-opus-4-5-20251101',
    modelCatalog: overrides.modelCatalog || ['claude-opus-4-5-20251101'],
    docUrl: overrides.docUrl,
    openAICodexAuthMode: overrides.openAICodexAuthMode,
    openAICodexTenantId: overrides.openAICodexTenantId,
    openAICodexAccountId: overrides.openAICodexAccountId,
    enabled: overrides.enabled ?? true
  }
}

describe('settings page provider template coverage', () => {
  it('fills all builtin providers when profiles are empty', () => {
    const profiles = ensureTemplateProfiles([])

    expect(profiles.length).toBe(AI_PROFILE_TEMPLATES.length)
    expect(getFirstMissingTemplateKey(profiles)).toBeNull()

    for (const template of AI_PROFILE_TEMPLATES) {
      const profile = profiles.find(item => resolveTemplateKeyFromProfile(item) === template.key)
      expect(profile).toBeDefined()
      expect(profile?.enabled).toBe(false)
      expect(profile?.apiKey).toBe('')
    }
  })

  it('preserves existing template profiles and avoids duplicates', () => {
    const existingOpenAI = createProfile({
      id: 'openai-existing',
      name: 'OpenAI 生产',
      vendor: 'openai',
      protocol: 'openai_compat',
      presetKey: 'openai',
      apiUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'sk-openai-existing',
      defaultModel: 'gpt-5.4',
      modelCatalog: ['gpt-5.4'],
      enabled: true
    })
    const existingMiniMax = createProfile({
      id: 'minimax-existing',
      name: 'MiniMax 团队',
      vendor: 'minimax',
      protocol: 'anthropic_compat',
      presetKey: 'minimax',
      apiUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-minimax-existing',
      defaultModel: 'MiniMax-M2.7',
      modelCatalog: ['MiniMax-M2.7'],
      enabled: true
    })

    const profiles = ensureTemplateProfiles([existingOpenAI, existingMiniMax])
    const openAIProfiles = profiles.filter(item => resolveTemplateKeyFromProfile(item) === 'openai')
    const miniMaxProfiles = profiles.filter(item => resolveTemplateKeyFromProfile(item) === 'minimax')

    expect(openAIProfiles).toHaveLength(1)
    expect(miniMaxProfiles).toHaveLength(1)
    expect(openAIProfiles[0].id).toBe('openai-existing')
    expect(openAIProfiles[0].apiKey).toBe('sk-openai-existing')
    expect(miniMaxProfiles[0].id).toBe('minimax-existing')
    expect(miniMaxProfiles[0].defaultModel).toBe('MiniMax-M2.7')
    expect(getFirstMissingTemplateKey(profiles)).toBeNull()
  })

  it('keeps non-template custom profiles untouched', () => {
    const customProfile = createProfile({
      id: 'custom-extra',
      name: '团队网关',
      vendor: 'custom',
      protocol: 'openai_compat',
      presetKey: 'custom',
      apiUrl: 'https://gateway.example.com/v1/responses',
      apiKey: 'sk-custom',
      defaultModel: 'custom-model'
    })

    const profiles = ensureTemplateProfiles([customProfile])
    const extra = profiles.find(item => item.id === 'custom-extra')

    expect(extra).toBeDefined()
    expect(extra?.name).toBe('团队网关')
    expect(extra?.apiUrl).toBe('https://gateway.example.com/v1/responses')
  })

  it('is idempotent across repeated normalization', () => {
    const once = ensureTemplateProfiles([])
    const twice = ensureTemplateProfiles(once)
    expect(twice).toEqual(once)
  })
})

describe('settings page provider UX contract', () => {
  it('expands provider step by default and disables duplicate add', () => {
    const source = fs.readFileSync(settingsPageFile, 'utf-8')

    expect(source).toContain('provider: true')
    expect(source).toContain('disabled={!canAddProfileFromTemplate}')
    expect(source).toContain('if (!firstMissingTemplateKey) return')
  })
})

