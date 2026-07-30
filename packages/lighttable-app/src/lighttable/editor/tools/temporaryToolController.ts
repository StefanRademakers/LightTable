import type { ToolId } from '../session/editorSession';

/**
 * Owns a temporary tool override such as Space-to-pan.
 *
 * The persistent tool remains document-owned. The override is deliberately
 * transient, never serialized, and must be reset when the active document or
 * window focus changes.
 */
export class TemporaryToolController {
  private override: ToolId | null = null;

  get activeTool(): ToolId | null {
    return this.override;
  }

  get active(): boolean {
    return this.override !== null;
  }

  begin(tool: ToolId): boolean {
    if (this.override === tool) return false;
    this.override = tool;
    return true;
  }

  end(tool?: ToolId): boolean {
    if (this.override === null || (tool !== undefined && this.override !== tool)) {
      return false;
    }
    this.override = null;
    return true;
  }

  effectiveTool(persistentTool: ToolId): ToolId {
    return this.override ?? persistentTool;
  }
}
