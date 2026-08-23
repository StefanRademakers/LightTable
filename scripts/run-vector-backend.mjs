import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!target || !['dev:desktop', 'dev:web', 'package:desktop'].includes(target)) {
  console.error('Usage: node scripts/run-vector-backend.mjs <dev:desktop|dev:web|package:desktop>');
  process.exit(2);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('npm_execpath is unavailable; start this diagnostic through `npm run`.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [npmCli, 'run', target],
  {
    stdio: 'inherit',
    windowsHide: false,
    env: {
      ...process.env,
      LIGHTTABLE_VECTOR_BACKEND: 'vello',
      // Keep a selectable backend bakeoff independent from the normal package.
      // On Windows an open LightTable.exe locks its own app.asar; a dedicated
      // output also prevents one backend build from silently replacing the other.
      ...(target === 'package:desktop'
        ? { LIGHTTABLE_PACKAGE_OUT: process.env.LIGHTTABLE_PACKAGE_OUT || 'out-vello' }
        : {})
    }
  }
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
