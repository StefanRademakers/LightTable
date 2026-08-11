import type { GenAiAssetReference, GenAiPromptBinding } from './contracts';

export interface GenAiAssetMentionOption {
  readonly token: string;
  readonly asset: GenAiAssetReference;
}

const tokenStem = (label: string): string => {
  const withoutExtension = label.replace(/\.[^.]+$/, '');
  const normalized = withoutExtension
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'asset';
};

export const createGenAiAssetMentionOptions = (
  assets: readonly GenAiAssetReference[]
): readonly GenAiAssetMentionOption[] => {
  const counts = new Map<string, number>();
  return [...assets]
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .map((asset) => {
      const stem = tokenStem(asset.label);
      const occurrence = (counts.get(stem.toLocaleLowerCase('en-US')) ?? 0) + 1;
      counts.set(stem.toLocaleLowerCase('en-US'), occurrence);
      return { token: `@${stem}${occurrence === 1 ? '' : `_${occurrence}`}`, asset };
    });
};

export const resolveGenAiPromptMentions = (
  prompt: string,
  options: readonly GenAiAssetMentionOption[]
): {
  readonly bindings: readonly GenAiPromptBinding[];
  readonly references: readonly GenAiAssetReference[];
  readonly missingTokens: readonly string[];
  readonly providerPrompt: string;
} => {
  const byToken = new Map(options.map((option) => [option.token.toLocaleLowerCase('en-US'), option]));
  const bindings: GenAiPromptBinding[] = [];
  const references: GenAiAssetReference[] = [];
  const missing = new Set<string>();
  const providerLabels = new Map<string, string>();
  const providerPrompt = prompt.replace(/@[a-zA-Z0-9_-]+/g, (token) => {
    const option = byToken.get(token.toLocaleLowerCase('en-US'));
    if (!option) {
      missing.add(token);
      return token;
    }
    let providerLabel = providerLabels.get(option.asset.id);
    if (!providerLabel) {
      providerLabel = `@image${providerLabels.size + 1}`;
      providerLabels.set(option.asset.id, providerLabel);
      references.push(option.asset);
      bindings.push({ token: option.token, assetId: option.asset.id, providerLabel });
    }
    return providerLabel;
  });
  return { bindings, references, missingTokens: [...missing], providerPrompt };
};
