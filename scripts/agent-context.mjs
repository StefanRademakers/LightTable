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

const readableFile = async (relativePath) => {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
};

const firstContentLine = (value) => {
  const line = value
    ?.split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find(Boolean);
  return line?.replace(/^#+\s*/u, '');
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
const queueNames = ['todo', 'todoLater', 'parked', 'done'];
const queueDirectories = new Map(await Promise.all(queueNames.map(async (queue) => (
  [queue, await directories(`work/${queue}`)]
))));
const taskDirectories = queueDirectories.get('todo');
const doneDirectories = new Set(queueDirectories.get('done'));
const taskPackages = await Promise.all(taskDirectories.map(async (directory) => {
  const relativePath = `work/todo/${directory}`;
  const taskText = await readableFile(`${relativePath}/task.txt`);
  const resumeText = await readableFile(`${relativePath}/resume.md`);
  return {
    directory,
    relativePath,
    taskText,
    resumeText,
    duplicateInDone: doneDirectories.has(directory)
  };
}));
const activeTasks = taskPackages.filter(({ taskText }) => taskText !== null);
const queueWarnings = [];
for (const task of taskPackages) {
  const reasons = [];
  if (task.taskText === null) reasons.push('missing task.txt; not actionable');
  if (task.duplicateInDone) reasons.push('same package name also exists in work/done');
  if (reasons.length > 0) queueWarnings.push({ relativePath: task.relativePath, reasons });
}
const queuedIds = new Map();
for (const queue of ['todo', 'todoLater', 'parked']) {
  for (const directory of queueDirectories.get(queue)) {
    const relativePath = `work/${queue}/${directory}`;
    if (await readableFile(`${relativePath}/task.txt`) === null) {
      if (queue !== 'todo') {
        queueWarnings.push({ relativePath, reasons: ['missing task.txt'] });
      }
    }
    const match = /^task_(\d+)/u.exec(directory);
    if (!match) continue;
    const id = Number.parseInt(match[1], 10);
    const entries = queuedIds.get(id) ?? [];
    entries.push({ queue, relativePath });
    queuedIds.set(id, entries);
  }
}
for (const [id, entries] of queuedIds) {
  if (new Set(entries.map(({ queue }) => queue)).size <= 1) continue;
  for (const entry of entries) {
    queueWarnings.push({
      relativePath: entry.relativePath,
      reasons: [`task ID ${id} also appears in another queue`]
    });
  }
}
for (const directory of doneDirectories) {
  const match = /^task_(\d+)/u.exec(directory);
  if (!match) continue;
  const id = Number.parseInt(match[1], 10);
  for (const entry of queuedIds.get(id) ?? []) {
    queueWarnings.push({
      relativePath: entry.relativePath,
      reasons: [`task ID ${id} also exists in work/done`]
    });
  }
}
const resumeCheckpoints = taskPackages.filter(({ resumeText }) => resumeText !== null);
const packages = await workspacePackages();
const recentCommitLog = git(
  'log', '--since=72 hours ago', '--date=short',
  '--pretty=format:%h%x09%ad%x09%s'
);
const recentCommits = recentCommitLog === '(unavailable)' || recentCommitLog === ''
  ? []
  : recentCommitLog.split(/\r?\n/u);
const stashLog = git('stash', 'list', '--date=iso', '--format=%gd%x09%H%x09%gs');
const stashes = stashLog === '(unavailable)' || stashLog === '' ? [] : stashLog.split(/\r?\n/u);

console.log('# LightTable agent context');
console.log(`Repository: ${root}`);
console.log(`Branch: ${git('branch', '--show-current') || '(detached)'}`);
console.log(`Commit: ${git('rev-parse', '--short', 'HEAD')}`);
console.log(`Worktree: ${statusLines.length === 0 ? 'clean' : `${statusLines.length} changed path(s)`}`);
for (const line of statusLines.slice(0, 30)) console.log(`  ${line}`);
if (statusLines.length > 30) console.log(`  ... ${statusLines.length - 30} more; run git status --short`);

console.log(`\nRecent commits (last 72 hours): ${recentCommits.length}`);
if (recentCommits.length === 0) console.log('  (none)');
else {
  for (const line of recentCommits.slice(0, 20)) console.log(`  ${line}`);
  if (recentCommits.length > 20) {
    console.log(`  ... ${recentCommits.length - 20} more; run git log --since="72 hours ago"`);
  }
}

console.log(`\nRecoverable Git stashes: ${stashes.length}`);
if (stashes.length === 0) console.log('  (none)');
else for (const line of stashes) console.log(`  ${line}`);

console.log('\nResume checkpoints:');
if (resumeCheckpoints.length === 0) console.log('  (none)');
else {
  for (const checkpoint of resumeCheckpoints) {
    console.log(`  ${checkpoint.relativePath}/resume.md`);
  }
}

console.log('\nActive task packages:');
if (activeTasks.length === 0) console.log('  (none)');
else {
  for (const task of activeTasks) {
    console.log(`  ${task.relativePath} — ${firstContentLine(task.taskText) ?? '(untitled task)'}`);
  }
}

console.log('\nQueue integrity warnings:');
if (queueWarnings.length === 0) console.log('  (none)');
else {
  for (const task of queueWarnings) {
    console.log(`  ${task.relativePath} — ${task.reasons.join('; ')}`);
  }
}

console.log('\nWorkspace packages:');
for (const workspacePackage of packages) console.log(`  ${workspacePackage}`);

console.log('\nRecovery route:');
console.log('  1. Read architecture/AGENT_ONBOARDING.md');
console.log('  2. Read every Resume checkpoint reported above and reconcile it with Git');
console.log('  3. Read architecture/QUICKSTART.md for the system model');
console.log('  4. Read architecture/CURRENT_STATE_AND_ROADMAP.md');
console.log('  5. Read only the requested/current task and routed contracts');
console.log('  6. Preserve unrelated worktree changes and resolve queue warnings explicitly');

console.log('\nRelease truth:');
console.log('  Technical preview != commercialReady. Never infer release approval from passing unit tests.');
