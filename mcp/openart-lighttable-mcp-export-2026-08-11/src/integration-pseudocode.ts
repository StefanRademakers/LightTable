/**
 * Protocol-agnostic pseudocode.
 * Wire `mcp.callTool` to whichever MCP TypeScript client LightTable adopts.
 */

type McpClient = {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
};

export class OpenArtService {
  constructor(private readonly mcp: McpClient) {}

  listModels() {
    return this.mcp.callTool("openart_model_list");
  }

  getForm(model: string, mode: string) {
    return this.mcp.callTool("openart_model_form_get", { model, mode });
  }

  estimateCost(model: string, mode: string, params: Record<string, unknown>) {
    return this.mcp.callTool("openart_model_cost", { model, mode, params });
  }

  generateImage(model: string, mode: string, params: Record<string, unknown>, projectId?: string) {
    return this.mcp.callTool("openart_generate_image", { model, mode, params, projectId });
  }

  generateVideo(model: string, mode: string, params: Record<string, unknown>, projectId?: string) {
    return this.mcp.callTool("openart_generate_video", { model, mode, params, projectId });
  }

  getCreation(historyId: string) {
    return this.mcp.callTool("openart_creation_get", { historyId });
  }
}
