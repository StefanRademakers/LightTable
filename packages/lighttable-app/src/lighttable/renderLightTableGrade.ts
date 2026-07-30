import { createWebGpuDocumentRenderer } from './infrastructure/rendering/webGpuDocumentRenderer';
import { createLightTableRecipe, type LightTableRecipe } from './lightTableRecipe';
import type { BasicAdjustments } from './types';

interface RenderLightTableGradeOptions {
  loadSource: (projectId: string, sourceFileKey: string) => Promise<Blob>;
  projectId: string;
  sourceFileKey: string;
  fileNameBase: string;
  settings: BasicAdjustments;
}

interface RenderedLightTableGrade {
  file: File;
  recipe: LightTableRecipe;
}

const buildOutputName = (base: string) => `${base.replace(/\.[^.]+$/, '') || 'image'}-lighttable.png`;

// Direct grade paste deliberately uses the same renderer adapter as the
// visible editor. The detached canvas is only a render target; hosts still own
// upload placement and project/shot version semantics.
export const renderLightTableGrade = async ({
  loadSource,
  projectId,
  sourceFileKey,
  fileNameBase,
  settings
}: RenderLightTableGradeOptions): Promise<RenderedLightTableGrade> => {
  const source = await loadSource(projectId, sourceFileKey);
  const canvas = document.createElement('canvas');
  const engine = await createWebGpuDocumentRenderer(canvas);
  try {
    await engine.loadImage(source, fileNameBase);
    engine.setAdjustments(settings);
    const blob = await engine.exportPng();
    return {
      file: new File([blob], buildOutputName(fileNameBase), { type: 'image/png' }),
      recipe: createLightTableRecipe(sourceFileKey, settings)
    };
  } finally {
    engine.destroy();
  }
};
