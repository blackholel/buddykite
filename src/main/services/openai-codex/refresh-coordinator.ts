export class OpenAICodexRefreshCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  async run<T>(credentialKey: string, refresh: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(credentialKey)
    if (existing) {
      return existing as Promise<T>
    }

    const task = refresh().finally(() => {
      this.inFlight.delete(credentialKey)
    })

    this.inFlight.set(credentialKey, task)
    return task
  }

  getInFlightCount(): number {
    return this.inFlight.size
  }
}
