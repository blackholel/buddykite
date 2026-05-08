export interface RailVisibilityInput {
  containerWidth: number
  turnCount: number
  headingCount: number
  isGenerating: boolean
  isCompact: boolean
}

export interface RailVisibilityResult {
  showRightRail: boolean
  showLeftRail: boolean
}

export const TURN_RAIL_MIN_WIDTH = 640
export const OUTLINE_RAIL_MIN_WIDTH = 360
export const OUTLINE_RAIL_EXPANDED_MIN_WIDTH = 1120

export function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function resolveRailVisibility(input: RailVisibilityInput): RailVisibilityResult {
  const showRightRail = input.containerWidth >= TURN_RAIL_MIN_WIDTH && input.turnCount >= 1
  const showLeftRail = (
    input.containerWidth >= OUTLINE_RAIL_MIN_WIDTH &&
    !input.isGenerating &&
    input.headingCount >= 1
  )

  return {
    showRightRail,
    showLeftRail
  }
}

export function scrollContainerToMessage(container: Pick<HTMLDivElement, 'querySelector'>, messageId: string): void {
  const target = container.querySelector<HTMLElement>(`[data-message-id=\"${escapeAttrValue(messageId)}\"]`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function scrollContainerToHeading(container: Pick<HTMLDivElement, 'querySelector'>, headingId: string): void {
  const target = container.querySelector<HTMLElement>(`[id=\"${escapeAttrValue(headingId)}\"]`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
