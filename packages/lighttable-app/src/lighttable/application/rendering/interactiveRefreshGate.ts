/**
 * Limits optional analysis work while an input gesture is active.
 *
 * The render loop may still run once per animation frame for direct visual
 * feedback. Expensive observers such as scopes use this gate so they do not
 * compete with the gesture for every frame. Outside an interaction, dirty
 * work is never delayed.
 */
export class InteractiveRefreshGate {
  private active = false;
  private lastRefreshAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs = 100) {}

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.lastRefreshAt = Number.NEGATIVE_INFINITY;
  }

  shouldRefresh(now: number) {
    if (!this.active) return true;
    if (now - this.lastRefreshAt < this.intervalMs) return false;
    this.lastRefreshAt = now;
    return true;
  }
}
