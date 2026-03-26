import { describe, expect, it } from 'vitest'
import {
  buildTemplateFilterState
} from '../extension-filtering'

describe('template library filter behavior', () => {
  it('keeps entry tab mapping and clears query on tab state build', () => {
    const skillsState = buildTemplateFilterState('skills')
    const agentsState = buildTemplateFilterState('agents')

    expect(skillsState).toEqual({ activeFilter: 'skills', query: '' })
    expect(agentsState).toEqual({ activeFilter: 'agents', query: '' })
  })
})
