import { useEffect, useState } from 'react';
import { parseLightTableSettings } from './lightTableRecipe';
import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from './types';
import type { GradeClipboardArtifactAssociation } from './application/commands/lightTableCommandContract';

const STORAGE_KEY = 'storybuilder:lighttable:grade-clipboard';
const CHANGE_EVENT = 'storybuilder:lighttable-grade-clipboard-change';

export interface LightTableGradeClipboard {
  type: 'lighttable-grade';
  name: string;
  copiedAt: string;
  settings: BasicAdjustments;
  /** Exact stored payload, including its unique copy token; never a timestamp match. */
  readonly captureIdentity?: string;
  readonly artifactAssociation?: GradeClipboardArtifactAssociation;
  /** Session-only source bytes used to carry an embedded Look across documents. */
  gradeLookAsset?: {
    readonly assetId: string;
    readonly name: string;
    readonly source: Blob;
  };
}

let sessionGradeLookAsset: LightTableGradeClipboard['gradeLookAsset'];
let sessionGradeIdentity = '';
let sessionArtifactAssociation: GradeClipboardArtifactAssociation | undefined;

const cloneSettings = (settings: BasicAdjustments): BasicAdjustments => cloneAdjustments(settings);

/** Lens FX is a separate document pass and never travels with a Grade recipe. */
export const gradeClipboardSettings = (settings: BasicAdjustments): BasicAdjustments => ({
  ...cloneSettings(settings),
  effects: createDefaultAdjustments().effects
});

/** Applies a copied Grade while preserving the destination's independent Lens FX pass. */
export const pasteGradeSettings = (
  destination: BasicAdjustments,
  copied: BasicAdjustments
): BasicAdjustments => ({
  ...cloneSettings(copied),
  effects: cloneSettings(destination).effects
});

export const readLightTableGrade = (): LightTableGradeClipboard | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    if (candidate.type !== 'lighttable-grade') return null;
    const settings = parseLightTableSettings(candidate.settings);
    if (!settings) return null;
    const copiedAt = typeof candidate.copiedAt === 'string' ? candidate.copiedAt : '';
    return {
      type: 'lighttable-grade',
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'Copied grade',
      copiedAt,
      settings,
      captureIdentity: raw,
      ...(sessionGradeIdentity === raw && sessionArtifactAssociation
        ? { artifactAssociation: sessionArtifactAssociation } : {}),
      ...(sessionGradeLookAsset && sessionGradeIdentity === raw
        ? { gradeLookAsset: sessionGradeLookAsset }
        : {})
    };
  } catch {
    return null;
  }
};

export const copyLightTableGrade = (
  settings: BasicAdjustments,
  name = 'Copied grade',
  gradeLookAsset?: LightTableGradeClipboard['gradeLookAsset'],
  artifactAssociation?: GradeClipboardArtifactAssociation
): LightTableGradeClipboard => {
  const grade: LightTableGradeClipboard = {
    type: 'lighttable-grade',
    name: name.trim() || 'Copied grade',
    copiedAt: new Date().toISOString(),
    settings: gradeClipboardSettings(settings),
    ...(gradeLookAsset ? { gradeLookAsset } : {})
  };
  // Binary LUT data intentionally remains session-only. Persisting a multi-MiB
  // .cube in localStorage would make an otherwise tiny Grade clipboard brittle.
  const { gradeLookAsset: _sessionOnlyAsset, ...serializable } = grade;
  const identity = JSON.stringify({ ...serializable, copyToken: crypto.randomUUID() });
  window.localStorage.setItem(STORAGE_KEY, identity);
  sessionGradeLookAsset = gradeLookAsset;
  sessionGradeIdentity = identity;
  sessionArtifactAssociation = artifactAssociation;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return { ...grade, captureIdentity: identity, ...(artifactAssociation ? { artifactAssociation } : {}) };
};

/** Paste may register an evicted/persisted capture, but must not perform another Copy. */
export const associateLightTableGradeArtifact = (
  grade: LightTableGradeClipboard,
  association: GradeClipboardArtifactAssociation
): boolean => {
  if (!grade.captureIdentity || window.localStorage.getItem(STORAGE_KEY) !== grade.captureIdentity) return false;
  sessionGradeIdentity = grade.captureIdentity;
  sessionGradeLookAsset = grade.gradeLookAsset;
  sessionArtifactAssociation = association;
  return true;
};

export const useLightTableGradeClipboard = () => {
  const [grade, setGrade] = useState<LightTableGradeClipboard | null>(readLightTableGrade);

  useEffect(() => {
    const refresh = () => setGrade(readLightTableGrade());
    window.addEventListener('storage', refresh);
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, []);

  return grade;
};
