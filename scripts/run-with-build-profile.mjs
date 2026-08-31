import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [profile, command, ...args] = process.argv.slice(2);
if (!['release', 'instrumented', 'debug'].includes(profile) || !command) {
  throw new Error('Usage: run-with-build-profile.mjs <release|instrumented|debug> <command> [...args]');
}

const env = { ...process.env };
// Preserve an explicit opt-out for UI-boundary checks while the guide defaults on.
delete env.LIGHTTABLE_VECTOR_PROFILE;
delete env.LIGHTTABLE_RENDER_TELEMETRY;
delete env.LIGHTTABLE_BUILD_PROFILE;

env.LIGHTTABLE_BUILD_PROFILE = profile;
if (profile !== 'release') {
  env.LIGHTTABLE_RENDER_TELEMETRY = '1';
}
if (profile === 'debug') {
  env.LIGHTTABLE_UI_DEVTOOLS = '1';
  env.LIGHTTABLE_VECTOR_PROFILE = '1';
}

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
