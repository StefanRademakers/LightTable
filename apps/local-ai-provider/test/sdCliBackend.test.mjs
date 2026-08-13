import { EventEmitter } from 'node:events';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StableDiffusionCppBackend } from '../src/sdCliBackend.mjs';

const request = {
  operation: 'image.create', modelId: 'flux-2-klein-4b', prompt: 'cancel me',
  output: { width: 512, height: 512, count: 1 }
};

describe('stable-diffusion.cpp backend lifecycle', () => {
  it('terminates native inference when a job is cancelled', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'lighttable-sd-cli-test-'));
    const kills = [];
    let child;
    const spawnProcess = () => {
      child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.kill = (signal) => {
        kills.push(signal);
        child.exitCode = 143;
        queueMicrotask(() => child.emit('exit', 143));
        return true;
      };
      return child;
    };
    const backend = new StableDiffusionCppBackend({
      executable: 'sd-cli.exe', diffusionModel: 'flux.gguf', vae: 'vae.gguf', llm: 'qwen.gguf',
      outputDirectory, spawnProcess
    });
    const controller = new AbortController();
    const running = backend.run({ jobId: 'cancelled', request, files: new Map(), signal: controller.signal });
    controller.abort();
    await assert.rejects(running, (error) => error?.code === 'JOB_CANCELLED');
    assert.deepEqual(kills, ['SIGTERM']);
    assert.deepEqual(await readdir(outputDirectory), []);
  });
});
