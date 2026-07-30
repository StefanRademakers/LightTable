import { useEffect, useState } from 'react';
import { resolveLightTableRecipe, type LightTableRecipe } from './lightTableRecipe';

export const useLightTableRecipe = (
  resolveMetadata: (projectId: string, fileKey: string) => Promise<unknown>,
  projectId: string,
  fileKey: string | null
): LightTableRecipe | null => {
  const [resolved, setResolved] = useState<{
    projectId: string;
    fileKey: string;
    recipe: LightTableRecipe | null;
  } | null>(null);

  useEffect(() => {
    let canceled = false;
    if (!projectId || !fileKey) return () => { canceled = true; };

    void resolveLightTableRecipe(resolveMetadata, projectId, fileKey)
      .then((recipe) => {
        if (!canceled) setResolved({ projectId, fileKey, recipe });
      })
      .catch(() => {
        // Missing or malformed recipe metadata means the edit action stays hidden.
        if (!canceled) setResolved({ projectId, fileKey, recipe: null });
      });

    return () => { canceled = true; };
  }, [fileKey, projectId, resolveMetadata]);

  return resolved?.projectId === projectId && resolved.fileKey === fileKey
    ? resolved.recipe
    : null;
};
