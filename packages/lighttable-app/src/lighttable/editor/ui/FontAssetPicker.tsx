import { Select } from '@lighttable/ui';
import { useMemo } from 'react';
import type { DocumentFontAsset } from '../document/documentTypes';

export function FontAssetPicker({ value, fonts, ariaLabel, onChange }: {
  value: string; fonts: readonly DocumentFontAsset[]; ariaLabel: string; onChange: (assetId: string) => void;
}) {
  const options = useMemo(() => (['bundled', 'document', 'system'] as const).flatMap(source =>
    fonts.filter(font => source === 'document' ? font.source !== 'bundled' && font.source !== 'system' : font.source === source)
      .map(font => ({ value: font.assetId,
        label: `${font.familyNames[0] ?? font.postScriptName ?? 'Unknown'} — ${font.styleName}`,
        group: source === 'bundled' ? 'Bundled' : source === 'system' ? 'System' : 'Document',
        searchText: [...font.familyNames, font.styleName, font.postScriptName ?? ''].join(' ')
      })).sort((left, right) => left.label.localeCompare(right.label))
  ), [fonts]);
  return <Select value={value} options={options} searchable searchPlaceholder="Search fonts"
    aria-label={ariaLabel} placeholder={options.some(option => option.value === value) ? undefined : 'Choose font'}
    onValueChange={onChange} />;
}
