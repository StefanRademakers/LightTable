import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const git = (...args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '(unavailable)';
  }
};

const directories = async (relativePath) => {
  try {
    return (await readdir(path.join(root, relativePath), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
  } catch {
    return [];
  }
};

const workspacePackages = async () => {
  const result = [];
  for (const parent of ['apps', 'packages']) {
    for (const directory of await directories(parent)) {
      try {
        const manifest = JSON.parse(await readFile(
          path.join(root, parent, directory, 'package.json'),
          'utf8'
        ));
        result.push(`${manifest.name ?? `${parent}/${directory}`} (${parent}/${directory})`);
      } catch {
        // A source directory without a package manifest is not a workspace package.
      }
    }
  }
  return result;
};

const status = git('status', '--short');
const statusLines = status === '(unavailable)' || status === '' ? [] : status.split(/\r?\n/u);
const taskDirectories = await directories('work/todo');
const packages = await workspacePackages();

console.log('# LightTable agent context');
console.log(`Repository: ${root}`);
console.log(`Branch: ${git('branch', '--show-current') || '(detached)'}`);
console.log(`Commit: ${git('rev-parse', '--short', 'HEAD')}`);
console.log(`Worktree: ${statusLines.length === 0 ? 'clean' : `${statusLines.length} changed path(s)`}`);
for (const line of statusLines.slice(0, 30)) console.log(`  ${line}`);
if (statusLines.length > 30) console.log(`  ... ${statusLines.length - 30} more; run git status --short`);

console.log('\nActive task packages:');
if (taskDirectories.length === 0) console.log('  (none)');
else for (const task of taskDirectories) console.log(`  work/todo/${task}`);

console.log('\nWorkspace packages:');
for (const workspacePackage of packages) console.log(`  ${workspacePackage}`);

console.log('\nRecovery route:');
console.log('  1. Read architecture/AGENT_ONBOARDING.md');
console.log('  2. Read architecture/QUICKSTART.md for the system model');
console.log('  3. Read architecture/CURRENT_STATE_AND_ROADMAP.md');
console.log('  4. Read only the active task and routed contracts');
console.log('  5. Preserve unrelated worktree changes');

console.log('\nRelease truth:');
console.log('  Technical preview != commercialReady. Never infer release approval from passing unit tests.');
