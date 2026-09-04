import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = npmCli
  ? [npmCli, 'run', 'build', '--workspace', '@lighttable/web']
  : ['run', 'build', '--workspace', '@lighttable/web'];

const result = spawnSync(command, args, {
  cwd: workspaceRoot,
  env: {
    ...process.env,
    LIGHTTABLE_STATIC_BUILD: '1',
    LIGHTTABLE_UI_DEVTOOLS: '0'
  },
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
