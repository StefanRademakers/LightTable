interface EyeDropperResult { readonly sRGBHex: string }
interface EyeDropperInstance { open(): Promise<EyeDropperResult> }
type EyeDropperConstructor = new () => EyeDropperInstance;

export const sampleScreenColor = async (): Promise<string | null> => {
  const EyeDropper = (globalThis as typeof globalThis & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  if (!EyeDropper) return null;
  try {
    const result = await new EyeDropper().open();
    return /^#[0-9a-f]{6}$/i.test(result.sRGBHex) ? result.sRGBHex.toLowerCase() : null;
  } catch {
    return null;
  }
};
