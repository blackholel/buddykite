export interface ResourceDisplayNameInput {
  name: string
  displayNameBase?: string
  displayNameLocalized?: string
  descriptionBase?: string
  descriptionLocalized?: string
  namespace?: string
}

export function getResourceUiDisplayName(input: ResourceDisplayNameInput): string {
  return input.displayNameLocalized ?? input.displayNameBase ?? input.name
}

export function getResourceUiDescription(input: ResourceDisplayNameInput): string | undefined {
  return input.descriptionLocalized ?? input.descriptionBase
}

export function getResourceDisplayName(input: ResourceDisplayNameInput): string {
  const base = getResourceUiDisplayName(input)
  return input.namespace ? `${input.namespace}:${base}` : base
}
