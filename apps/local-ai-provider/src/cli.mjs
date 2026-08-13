import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeInferenceBackend } from './fakeBackend.mjs';
import { StableDiffusionCppBackend } from './sdCliBackend.mjs';
import { LocalAiProviderServer } from './server.mjs';
import { modelPaths } from './modelManifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const host = process.env.LIGHTTABLE_LOCAL_AI_HOST ?? '127.0.0.1';
const port = Number(process.env.LIGHTTABLE_LOCAL_AI_PORT ?? 7862);
const token = process.env.LIGHTTABLE_LOCAL_AI_TOKEN ?? randomBytes(24).toString('hex');
const modelDirectory = process.env.LIGHTTABLE_LOCAL_AI_MODEL_DIR ?? path.join(root, '.local-ai/models');
const installedModels = await modelPaths(modelDirectory);
const defaultRuntime = path.join(
  root,
  '.referenceCode/local-ai-runtime',
  process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli'
);
const runtimeConfiguration = {
  executable: process.env.LIGHTTABLE_SD_CLI ?? defaultRuntime,
  diffusionModel: process.env.LIGHTTABLE_FLUX_MODEL ?? installedModels.diffusionModel,
  vae: process.env.LIGHTTABLE_FLUX_VAE ?? installedModels.vae,
  llm: process.env.LIGHTTABLE_FLUX_LLM ?? installedModels.llm
};
if (process.env.LIGHTTABLE_LOCAL_AI_FAKE !== 'true') {
  await assertRuntimeReady(runtimeConfiguration);
}
const backend = process.env.LIGHTTABLE_LOCAL_AI_FAKE === 'true'
  ? new FakeInferenceBackend()
  : new StableDiffusionCppBackend({
    ...runtimeConfiguration,
    outputDirectory: process.env.LIGHTTABLE_LOCAL_AI_OUTPUT ?? path.join(root, '.local-ai/outputs')
  });
const server = await new LocalAiProviderServer({
  backend, host, port, token,
  workDirectory: process.env.LIGHTTABLE_LOCAL_AI_WORK ?? path.join(root, '.local-ai/jobs')
}).listen();

// This startup record is the only place the session token is emitted. The
// desktop process reads it from the child pipe; it must never enter UI logs.
process.stdout.write(`${JSON.stringify({ type: 'ready', host, port: server.port, token })}\n`);
const shutdown = async () => { await server.close(); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

async function assertRuntimeReady(configuration) {
  for (const [label, filename] of Object.entries(configuration)) {
    try {
      await access(filename);
    } catch {
      const error = new Error(`Local AI ${label} is not installed: ${filename}`);
      error.code = label === 'executable' ? 'RUNTIME_NOT_INSTALLED' : 'MODEL_NOT_INSTALLED';
      throw error;
    }
  }
}
