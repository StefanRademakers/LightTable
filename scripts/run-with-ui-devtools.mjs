import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Usage: run-with-ui-devtools.mjs <command> [...args]');

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env: { ...process.env, LIGHTTABLE_UI_DEVTOOLS: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
