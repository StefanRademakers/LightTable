/** Rejects async realization results produced for an obsolete revision. */
export class StaleWorkGate {
  private readonly generations = new Map<string, number>();

  begin(key: string) {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return { key, generation } as const;
  }

  isCurrent(token: Readonly<{ key: string; generation: number }>) {
    return this.generations.get(token.key) === token.generation;
  }

  invalidate(key: string) {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  clear() {
    this.generations.clear();
  }
}
