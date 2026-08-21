import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  applyWindowsFileAssociationPlan,
  createWindowsFileAssociationPlan
} from './windowsFileAssociations';

type SquirrelEvent = '--squirrel-install' | '--squirrel-updated'
  | '--squirrel-uninstall' | '--squirrel-obsolete';

export const squirrelEventFromArgv = (argv: readonly string[]): SquirrelEvent | null => {
  const value = argv[1];
  return value === '--squirrel-install' || value === '--squirrel-updated'
    || value === '--squirrel-uninstall' || value === '--squirrel-obsolete' ? value : null;
};
export const handleSquirrelStartup = (
  argv: readonly string[],
  executablePath: string
): boolean => {
  if (process.platform !== 'win32') return false;
  const event = squirrelEventFromArgv(argv);
  if (!event) return false;
  const appFolder = path.dirname(executablePath);
  const installRoot = path.dirname(appFolder);
  const stableExecutable = path.join(installRoot, path.basename(executablePath));
  const updateExecutable = path.join(installRoot, 'Update.exe');
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    applyWindowsFileAssociationPlan(createWindowsFileAssociationPlan(stableExecutable, 'register'));
    spawnSync(updateExecutable, ['--createShortcut', path.basename(executablePath)], { windowsHide: true });
  } else if (event === '--squirrel-uninstall') {
    applyWindowsFileAssociationPlan(createWindowsFileAssociationPlan(stableExecutable, 'unregister'));
    spawnSync(updateExecutable, ['--removeShortcut', path.basename(executablePath)], { windowsHide: true });
  }
  return true;
};
