import type { ToolId } from '../session/editorSession';

export interface TemporaryToolSnapshot {
  readonly tool: ToolId | null;
  readonly zoomOut: boolean;
}
const idle: TemporaryToolSnapshot = Object.freeze({ tool: null, zoomOut: false });

/**
 * Owns a temporary tool override such as Space-to-pan.
 *
 * The persistent tool remains editor-session preference. The override is deliberately
 * transient, never serialized, and must be reset when the active document or
 * window focus changes.
 */
export class TemporaryToolController {
  private snapshot: TemporaryToolSnapshot = idle;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): TemporaryToolSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: TemporaryToolSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  get activeTool(): ToolId | null {
    return this.snapshot.tool;
  }

  get active(): boolean {
    return this.snapshot.tool !== null;
  }

  begin(tool: ToolId, zoomOut = false): boolean {
    if (this.snapshot.tool === tool) return false;
    this.publish(Object.freeze({ tool, zoomOut: tool === 'zoom' && zoomOut }));
    return true;
  }

  end(tool?: ToolId): boolean {
    if (this.snapshot.tool === null || (tool !== undefined && this.snapshot.tool !== tool)) {
      return false;
    }
    this.publish(idle);
    return true;
  }

  effectiveTool(persistentTool: ToolId): ToolId {
    return this.snapshot.tool ?? persistentTool;
  }
}
