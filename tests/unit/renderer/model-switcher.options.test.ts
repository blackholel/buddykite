import { describe, expect, it } from 'vitest'
import type { ApiProfile } from '../../../src/renderer/types'
import { buildModelOptions } from '../../../src/renderer/components/chat/ModelSwitcher'

function createProfile(overrides: Partial<ApiProfile>): ApiProfile {
  return {
    id: 'p1',
    name: 'OpenAI',
    vendor: 'openai',
    protocol: 'openai_compat',
    apiUrl: 'https://api.openai.com/v1/responses',
    apiKey: 'k',
    defaultModel: 'gpt-5.4',
    modelCatalog: ['gpt-5.4'],
    enabled: true,
    ...overrides
  }
}

describe('buildModelOptions', () => {
  it('只使用 defaultModel，不展开 modelCatalog', () => {
    const profiles: ApiProfile[] = [
      createProfile({
        id: 'openai',
        name: 'OpenAI',
        defaultModel: 'gpt-5.4',
        modelCatalog: ['gpt-5.4', 'gpt-4o', 'gpt-5-codex']
      }),
      createProfile({
        id: 'minimax',
        name: 'MiniMax',
        vendor: 'minimax',
        protocol: 'anthropic_compat',
        defaultModel: 'MiniMax-M2.7',
        modelCatalog: ['MiniMax-M2.7', 'MiniMax-M2.5']
      })
    ]

    expect(buildModelOptions(profiles)).toEqual([
      {
        profileId: 'openai',
        profileName: 'OpenAI',
        model: 'gpt-5.4',
        displayName: 'OpenAI · gpt-5.4'
      },
      {
        profileId: 'minimax',
        profileName: 'MiniMax',
        model: 'MiniMax-M2.7',
        displayName: 'MiniMax · MiniMax-M2.7'
      }
    ])
  })

  it('defaultModel 为空时跳过该 profile', () => {
    const profiles: ApiProfile[] = [
      createProfile({
        id: 'openai',
        name: 'OpenAI',
        defaultModel: '   ',
        modelCatalog: ['gpt-5.4']
      })
    ]

    expect(buildModelOptions(profiles)).toEqual([])
  })
})
