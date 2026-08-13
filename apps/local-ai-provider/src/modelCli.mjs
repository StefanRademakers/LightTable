import path from 'node:path';
import { inspectModelInstallation, installModels } from './modelManifest.mjs';

const [command = 'status', directoryArgument] = process.argv.slice(2);
const directory = path.resolve(directoryArgument ?? process.env.LIGHTTABLE_LOCAL_AI_MODEL_DIR ?? '.local-ai/models');
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (command === 'status') {
  const result = await inspectModelInstallation(directory);
  write(toStatus(result, directory));
} else if (command === 'install') {
  const result = await installModels(directory, {
    onProgress: (progress) => write({ type: 'progress', ...progress })
  });
  write({ ...toStatus(result, directory), type: 'complete' });
} else {
  throw new Error(`Unknown local AI model command: ${command}`);
}

function toStatus(result, modelDirectory) {
  return {
    type: 'status', modelId: result.manifest.modelId, displayName: result.manifest.displayName,
    directory: modelDirectory, ready: result.ready,
    installedBytes: result.files.reduce((sum, file) => sum + (file.valid ? file.bytes : 0), 0),
    totalBytes: result.files.reduce((sum, file) => sum + file.bytes, 0),
    files: result.files.map((file) => ({
      filename: file.filename, bytes: file.bytes, installed: file.installed, valid: file.valid
    }))
  };
}
