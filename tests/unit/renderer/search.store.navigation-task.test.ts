import { beforeEach, describe, expect, it } from 'vitest'
import { useSearchStore } from '../../../src/renderer/stores/search.store'

describe('search store navigation task lifecycle', () => {
  beforeEach(() => {
    useSearchStore.setState({
      activeNavigationTaskId: null,
      navigationTaskCounter: 0
    })
  })

  it('快速触发多次 begin 时，仅最后一个 task 保持 active', () => {
    const firstTask = useSearchStore.getState().beginNavigationTask()
    const secondTask = useSearchStore.getState().beginNavigationTask()
    const thirdTask = useSearchStore.getState().beginNavigationTask()

    expect(firstTask).toBe(1)
    expect(secondTask).toBe(2)
    expect(thirdTask).toBe(3)
    expect(useSearchStore.getState().isNavigationTaskActive(firstTask)).toBe(false)
    expect(useSearchStore.getState().isNavigationTaskActive(secondTask)).toBe(false)
    expect(useSearchStore.getState().isNavigationTaskActive(thirdTask)).toBe(true)
    expect(useSearchStore.getState().activeNavigationTaskId).toBe(thirdTask)
  })

  it('旧 task 完成不会清掉新 task，避免串扰', () => {
    const firstTask = useSearchStore.getState().beginNavigationTask()
    const secondTask = useSearchStore.getState().beginNavigationTask()

    useSearchStore.getState().finishNavigationTask(firstTask)

    expect(useSearchStore.getState().activeNavigationTaskId).toBe(secondTask)
    expect(useSearchStore.getState().isNavigationTaskActive(secondTask)).toBe(true)

    useSearchStore.getState().finishNavigationTask(secondTask)
    expect(useSearchStore.getState().activeNavigationTaskId).toBeNull()
  })

  it('cancelNavigationTask 会立即使所有 task 失活', () => {
    const taskId = useSearchStore.getState().beginNavigationTask()
    expect(useSearchStore.getState().isNavigationTaskActive(taskId)).toBe(true)

    useSearchStore.getState().cancelNavigationTask()

    expect(useSearchStore.getState().activeNavigationTaskId).toBeNull()
    expect(useSearchStore.getState().isNavigationTaskActive(taskId)).toBe(false)
  })
})
