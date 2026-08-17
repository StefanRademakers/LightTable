import { useEffect, useState } from 'react';
import { parseLightTableSettings } from './lightTableRecipe';
import { cloneAdjustments, createDefaultAdjustments, type BasicAdjustments } from './types';

const STORAGE_KEY = 'storybuilder:lighttable:grade-clipboard';
const CHANGE_EVENT = 'storybuilder:lighttable-grade-clipboard-change';

export interface LightTableGradeClipboard {
  type: 'lighttable-grade';
  name: string;
  copiedAt: string;
  settings: BasicAdjustments;
}

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
    return {
      type: 'lighttable-grade',
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'Copied grade',
      copiedAt: typeof candidate.copiedAt === 'string' ? candidate.copiedAt : '',
      settings
    };
  } catch {
    return null;
  }
};

export const copyLightTableGrade = (settings: BasicAdjustments, name = 'Copied grade'): LightTableGradeClipboard => {
  const grade: LightTableGradeClipboard = {
    type: 'lighttable-grade',
    name: name.trim() || 'Copied grade',
    copiedAt: new Date().toISOString(),
    settings: gradeClipboardSettings(settings)
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(grade));
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return grade;
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
