import { PAINT_SCENE_SCHEMA_VERSION, type PaintScene } from './types';

/** Validates structural invariants at the renderer trust boundary. */
export const assertPaintSceneIsValid = (scene: PaintScene): void => {
  if (scene.schemaVersion !== PAINT_SCENE_SCHEMA_VERSION) {
    throw new Error(`Unsupported paint-scene schema ${scene.schemaVersion}.`);
  }
  for (const fragment of scene.fragments) {
    const pathIds = new Set<string>();
    for (const path of fragment.paths) {
      if (pathIds.has(path.stableId)) {
        throw new Error(`Paint-scene fragment ${fragment.stableId} has duplicate path ${path.stableId}.`);
      }
      pathIds.add(path.stableId);
    }
    let clipDepth = 0;
    for (const command of fragment.commands) {
      if (command.kind === 'pop-clip') {
        if (clipDepth === 0) {
          throw new Error(`Paint-scene fragment ${fragment.stableId} pops an empty clip stack.`);
        }
        clipDepth -= 1;
        continue;
      }
      if (!pathIds.has(command.pathId)) {
        throw new Error(
          `Paint-scene fragment ${fragment.stableId} references missing path ${command.pathId}.`
        );
      }
      if (command.kind === 'push-clip') clipDepth += 1;
    }
    if (clipDepth !== 0) {
      throw new Error(`Paint-scene fragment ${fragment.stableId} leaves clip layers unclosed.`);
    }
  }
};

