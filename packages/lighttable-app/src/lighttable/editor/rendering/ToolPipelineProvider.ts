import {
  toolPipelinesFor,
  type ToolPipelineBundle
} from './ToolPipelineBundle';

export type ToolPipelineCompiler = (device: GPUDevice) => ToolPipelineBundle;

/**
 * Document-scoped lazy access to the shared optional authoring pipelines.
 * Constructing or opening a document does not compile paint/selection/
 * transform shaders; the first command that needs them crosses this boundary.
 */
export class ToolPipelineProvider {
  private bundle: ToolPipelineBundle | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly compile: ToolPipelineCompiler = toolPipelinesFor
  ) {}

  get = () => {
    this.bundle ??= this.compile(this.device);
    return this.bundle;
  };

  isInitialized() {
    return this.bundle !== null;
  }
}
