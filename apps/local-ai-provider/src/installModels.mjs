import path from 'node:path';
import { installModels } from './modelManifest.mjs';

const directory = path.resolve(process.argv[2] ?? process.env.LIGHTTABLE_LOCAL_AI_MODEL_DIR ?? '.local-ai/models');
const result = await installModels(directory, { onProgress: ({ phase, file, received, total }) => {
  const percent = total ? Math.floor(received / total * 100) : 0;
  process.stdout.write(`\r${phase.padEnd(11)} ${file} ${String(percent).padStart(3)}%`);
  if (phase === 'installed' || phase === 'verified') process.stdout.write('\n');
} });
process.stdout.write(`Local AI model ${result.ready ? 'is ready' : 'is incomplete'} in ${directory}\n`);
if (!result.ready) process.exitCode = 1;
