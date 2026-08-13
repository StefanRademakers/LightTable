import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');
const outputDirectory = path.join(repository, '.local-ai', 'smoke');
const child = spawn(process.execPath, [path.join(repository, 'apps/local-ai-provider/src/cli.mjs')], {
  cwd: repository,
  env: { ...process.env, LIGHTTABLE_LOCAL_AI_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
try {
  const ready = await readReady(child);
  const headers = { Authorization: `Bearer ${ready.token}` };
  const baseUrl = `http://${ready.host}:${ready.port}`;
  const created = await runJob(baseUrl, headers, {
    operation: 'image.create', intent: 'general-create', modelId: 'flux-2-klein-4b',
    prompt: 'A blue glass perfume bottle on pale stone, clean product photography',
    seed: 137, output: { width: 512, height: 512, count: 1, mimeType: 'image/png', includeAlpha: false }
  });
  const edited = await runJob(baseUrl, headers, {
    operation: 'image.edit', intent: 'general-edit', modelId: 'flux-2-klein-4b',
    prompt: 'Keep the composition and bottle shape, change the glass from blue to ruby red',
    seed: 138, output: { width: 512, height: 512, count: 1, mimeType: 'image/png', includeAlpha: false },
    baseImage: { field: 'base-image', mimeType: 'image/png' }
  }, [{ field: 'base-image', bytes: created.bytes, mediaType: 'image/png', name: 'created.png' }]);
  await mkdir(outputDirectory, { recursive: true });
  const createOutput = path.join(outputDirectory, 'flux2-klein-http-create.png');
  const editOutput = path.join(outputDirectory, 'flux2-klein-http-edit.png');
  await Promise.all([writeFile(createOutput, created.bytes), writeFile(editOutput, edited.bytes)]);
  process.stdout.write(`${JSON.stringify({
    createOutput, editOutput, createGeneration: created.result.generation, editGeneration: edited.result.generation
  })}\n`);
} finally {
  child.kill('SIGTERM');
}

async function runJob(baseUrl, headers, request, inputs = []) {
  const form = new FormData();
  form.set('request', new Blob([JSON.stringify(request)], { type: 'application/json' }), 'request.json');
  for (const input of inputs) {
    form.set(input.field, new Blob([input.bytes], { type: input.mediaType }), input.name);
  }
  const accepted = await checkedFetch(`${baseUrl}/api/v1/jobs`, { method: 'POST', headers, body: form });
  const job = await accepted.json();
  let status;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = await checkedFetch(`${baseUrl}/api/v1/jobs/${job.jobId}`, { headers }).then((response) => response.json());
  } while (!['completed', 'failed', 'cancelled'].includes(status.status));
  if (status.status !== 'completed') throw new Error(`Local AI job ended as ${status.status}: ${status.error?.message ?? ''}`);
  const result = await checkedFetch(`${baseUrl}/api/v1/jobs/${job.jobId}/result`, { headers }).then((response) => response.json());
  const image = await checkedFetch(new URL(result.images[0].url, baseUrl), { headers });
  return { result, bytes: Buffer.from(await image.arrayBuffer()) };
}

async function checkedFetch(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response;
}

async function readReady(process) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error(`Provider startup timed out. ${stderr}`)), 30_000);
    process.once('exit', (code) => reject(new Error(`Provider exited (${code}). ${stderr}`)));
    process.stdout.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
  });
}
