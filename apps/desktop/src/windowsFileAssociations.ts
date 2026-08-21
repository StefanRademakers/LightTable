import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { NATIVE_BITMAP_FORMATS } from '@lighttable/app/bitmap-formats';

const CLASSES = 'HKCU\\Software\\Classes';
const CAPABILITIES = 'HKCU\\Software\\MediaVibe\\LightTable\\Capabilities';
const REGISTERED_APPLICATIONS = 'HKCU\\Software\\RegisteredApplications';
const APPLICATION = `${CLASSES}\\Applications\\LightTable.exe`;

export type WindowsRegistryMutation =
  | { readonly kind: 'set'; readonly key: string; readonly name?: string; readonly value: string }
  | { readonly kind: 'delete-value'; readonly key: string; readonly name: string }
  | { readonly kind: 'delete-key'; readonly key: string };

const progId = (formatId: string) => `LightTable.${formatId}`;

/** Declarative, testable HKCU registration; no file type is made the default. */
export const createWindowsFileAssociationPlan = (
  executablePath: string,
  operation: 'register' | 'unregister'
): readonly WindowsRegistryMutation[] => {
  const executable = path.resolve(executablePath);
  if (operation === 'unregister') {
    return [
      ...NATIVE_BITMAP_FORMATS.flatMap((format) => format.extensions.map((extension) => ({
        kind: 'delete-value' as const,
        key: `${CLASSES}\\${extension}\\OpenWithProgids`,
        name: progId(format.id)
      }))),
      { kind: 'delete-value', key: REGISTERED_APPLICATIONS, name: 'LightTable' },
      ...NATIVE_BITMAP_FORMATS.map((format) => ({
        kind: 'delete-key' as const, key: `${CLASSES}\\${progId(format.id)}`
      })),
      { kind: 'delete-key', key: APPLICATION },
      { kind: 'delete-key', key: CAPABILITIES }
    ];
  }

  const command = `"${executable}" "%1"`;
  return [
    { kind: 'set', key: APPLICATION, name: 'FriendlyAppName', value: 'LightTable' },
    { kind: 'set', key: `${APPLICATION}\\shell\\open\\command`, value: command },
    ...NATIVE_BITMAP_FORMATS.flatMap((format) => [
      { kind: 'set' as const, key: `${CLASSES}\\${progId(format.id)}`, value: `${format.label} image` },
      { kind: 'set' as const, key: `${CLASSES}\\${progId(format.id)}\\DefaultIcon`, value: `"${executable}",0` },
      { kind: 'set' as const, key: `${CLASSES}\\${progId(format.id)}\\shell\\open\\command`, value: command },
      ...format.extensions.flatMap((extension) => [
        { kind: 'set' as const, key: `${CLASSES}\\${extension}\\OpenWithProgids`, name: progId(format.id), value: '' },
        { kind: 'set' as const, key: `${APPLICATION}\\SupportedTypes`, name: extension, value: '' },
        { kind: 'set' as const, key: `${CAPABILITIES}\\FileAssociations`, name: extension, value: progId(format.id) }
      ])
    ]),
    { kind: 'set', key: CAPABILITIES, name: 'ApplicationName', value: 'LightTable' },
    { kind: 'set', key: CAPABILITIES, name: 'ApplicationDescription', value: 'GPU-first professional image editor' },
    { kind: 'set', key: CAPABILITIES, name: 'ApplicationIcon', value: `"${executable}",0` },
    { kind: 'set', key: REGISTERED_APPLICATIONS, name: 'LightTable', value: 'Software\\MediaVibe\\LightTable\\Capabilities' }
  ];
};
export const applyWindowsFileAssociationPlan = (
  mutations: readonly WindowsRegistryMutation[],
  run: typeof spawnSync = spawnSync
): void => {
  for (const mutation of mutations) {
    const args = mutation.kind === 'set'
      ? ['add', mutation.key, mutation.name ? '/v' : '/ve', mutation.name ?? '', '/t', 'REG_SZ', '/d', mutation.value, '/f']
        .filter((value, index, all) => !(index === 3 && all[2] === '/ve'))
      : mutation.kind === 'delete-value'
        ? ['delete', mutation.key, '/v', mutation.name, '/f']
        : ['delete', mutation.key, '/f'];
    const result = run('reg.exe', args, { encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    // Missing values during uninstall are already in the desired state.
    if (result.status !== 0 && mutation.kind === 'set') {
      throw new Error(`Windows file association registration failed: ${result.stderr || result.stdout}`);
    }
  }
};
