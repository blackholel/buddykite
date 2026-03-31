import { describe, expect, it } from 'vitest'
import {
  pickStrictIntentHints,
  resolveStrictIntentKeywordsFromConfig
} from '../../../src/shared/skill-creation-config'

describe('skill-creation-config', () => {
  it('未配置时返回默认关键词', () => {
    const keywords = resolveStrictIntentKeywordsFromConfig({})
    expect(keywords).toContain('review')
    expect(keywords).toContain('评测')
  })

  it('配置 strictIntentKeywords 后使用配置值', () => {
    const keywords = resolveStrictIntentKeywordsFromConfig({
      resourceCreation: {
        skill: {
          strictIntentKeywords: ['rubric', 'qa-gate']
        }
      }
    })
    expect(keywords).toEqual(['rubric', 'qa-gate'])
  })

  it('可命中自定义关键词且大小写不敏感', () => {
    const hints = pickStrictIntentHints(
      'Need QA-GATE review for this skill',
      ['rubric', 'qa-gate']
    )
    expect(hints).toEqual(['qa-gate'])
  })
})
