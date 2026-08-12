import { describe, expect, it } from 'vitest';
import { normalizeDesktopGenAiError } from './desktopGenAiError';

describe('normalizeDesktopGenAiError', () => {
  it('removes Electron IPC implementation wording', () => {
    expect(normalizeDesktopGenAiError(new Error(
      "Error invoking remote method 'lighttable:genai-generation-submit': Error: Could not publish character.png."
    )).message).toBe('Could not publish character.png.');
  });

  it('preserves an application error message', () => {
    expect(normalizeDesktopGenAiError(new Error('OpenArt rejected the request.')).message)
      .toBe('OpenArt rejected the request.');
  });
});
