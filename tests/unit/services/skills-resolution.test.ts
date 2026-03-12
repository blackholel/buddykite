import { describe, expect, it } from 'vitest'
import { resolveSkillLookupFromList, type SkillDefinition } from '../../../src/main/services/skills.service'

function makeSkill(
  name: string,
  overrides: Partial<SkillDefinition> = {}
): SkillDefinition {
  return {
    name,
    path: `/tmp/${name}`,
    source: 'app',
    exposure: 'public',
    ...overrides,
  }
}

describe('skills.service resolveSkillLookupFromList', () => {
  it('prefers exact name match', () => {
    const skills: SkillDefinition[] = [
      makeSkill('qiaomu-x-article-publisher', { displayName: 'x-article-publisher' }),
      makeSkill('x-article-publisher'),
    ]

    const result = resolveSkillLookupFromList(skills, 'x-article-publisher', {
      disallowAmbiguousAlias: true,
    })

    expect(result.skill?.name).toBe('x-article-publisher')
    expect(result.matchedBy).toBe('exact')
    expect(result.ambiguous).toHaveLength(0)
  })

  it('supports prefix alias fallback for qiaomu-* skills', () => {
    const skills: SkillDefinition[] = [
      makeSkill('qiaomu-x-article-publisher', { displayName: 'x-article-publisher' }),
    ]

    const result = resolveSkillLookupFromList(skills, 'x-article-publisher', {
      disallowAmbiguousAlias: true,
      prefixAliasEnabled: true,
    })

    expect(result.skill?.name).toBe('qiaomu-x-article-publisher')
    expect(result.matchedBy).toBe('alias')
  })

  it('returns ambiguity instead of silent fallback when disallowAmbiguousAlias=true', () => {
    const skills: SkillDefinition[] = [
      makeSkill('qiaomu-x-article-publisher', { displayName: 'x-article-publisher' }),
      makeSkill('demo-x-article-publisher', { displayName: 'x-article-publisher' }),
    ]

    const result = resolveSkillLookupFromList(skills, 'x-article-publisher', {
      disallowAmbiguousAlias: true,
      prefixAliasEnabled: true,
    })

    expect(result.skill).toBeNull()
    expect(result.ambiguous.map((item) => item.name).sort()).toEqual([
      'demo-x-article-publisher',
      'qiaomu-x-article-publisher',
    ])
  })
})
