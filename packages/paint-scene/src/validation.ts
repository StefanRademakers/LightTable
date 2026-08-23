import { PAINT_SCENE_SCHEMA_VERSION, type PaintScene } from './types';

const MAX_COMPOSITION_DEPTH = 64;

/** Validates structural invariants at the renderer trust boundary. */
export const assertPaintSceneIsValid = (scene: PaintScene): void => {
  if (scene.schemaVersion !== PAINT_SCENE_SCHEMA_VERSION) {
    throw new Error(`Unsupported paint-scene schema ${scene.schemaVersion}.`);
  }
  const fragmentIds = new Set<string>();
  for (const fragment of scene.fragments) {
    if (fragmentIds.has(fragment.stableId)) {
      throw new Error(`Paint scene has duplicate fragment ${fragment.stableId}.`);
    }
    fragmentIds.add(fragment.stableId);
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

  const clipIds = new Set<string>();
  for (const clip of scene.clips) {
    if (clipIds.has(clip.stableId)) {
      throw new Error(`Paint scene has duplicate clip ${clip.stableId}.`);
    }
    clipIds.add(clip.stableId);
  }

  const referencedFragments = new Set<string>();
  const visit = (nodes: PaintScene['composition'], depth: number): void => {
    if (depth > MAX_COMPOSITION_DEPTH) {
      throw new Error(`Paint-scene composition exceeds ${MAX_COMPOSITION_DEPTH} levels.`);
    }
    for (const node of nodes) {
      if (node.kind === 'fragment') {
        if (!fragmentIds.has(node.stableId)) {
          throw new Error(`Paint-scene composition references missing fragment ${node.stableId}.`);
        }
        if (referencedFragments.has(node.stableId)) {
          throw new Error(`Paint-scene composition references fragment ${node.stableId} more than once.`);
        }
        referencedFragments.add(node.stableId);
        continue;
      }
      if (!clipIds.has(node.stableId)) {
        throw new Error(`Paint-scene composition references missing clip ${node.stableId}.`);
      }
      if (node.children.length === 0) {
        throw new Error(`Paint-scene clip ${node.stableId} has no children.`);
      }
      visit(node.children, depth + 1);
    }
  };
  visit(scene.composition, 1);
};
