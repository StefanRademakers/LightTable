import { spawn } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pngDimensions } from './png.mjs';

const requiredFile = (value, label) => {
  if (!value) throw Object.assign(new Error(`${label} is not configured.`), { code: 'MODEL_NOT_INSTALLED' });
  return path.resolve(value);
};

export class StableDiffusionCppBackend {
  constructor(options) {
    this.executable = requiredFile(options.executable, 'sd-cli executable');
    this.diffusionModel = requiredFile(options.diffusionModel, 'FLUX diffusion model');
    this.vae = requiredFile(options.vae, 'FLUX VAE');
    this.llm = requiredFile(options.llm, 'Qwen text encoder');
    this.outputDirectory = path.resolve(options.outputDirectory);
  }

  async ready() {
    await Promise.all([this.executable, this.diffusionModel, this.vae, this.llm].map((filename) => access(filename)));
    return true;
  }

  async run({ jobId, request, files, signal, onProgress }) {
    await mkdir(this.outputDirectory, { recursive: true });
    const outputPattern = path.join(this.outputDirectory, `${jobId}-%03d.png`);
    const seed = Number.isInteger(request.seed) ? request.seed : -1;
    const steps = Math.max(1, Math.min(20, Number(request.modelSettings?.steps ?? 4)));
    const args = [
      '--diffusion-model', this.diffusionModel,
      '--vae', this.vae,
      '--llm', this.llm,
      '--prompt', request.prompt,
      '--output', outputPattern,
      '--output-begin-idx', '1',
      '--width', String(request.output.width),
      '--height', String(request.output.height),
      '--batch-count', String(request.output.count),
      '--steps', String(steps),
      '--cfg-scale', '1.0',
      '--sampling-method', 'euler',
      '--seed', String(seed),
      '--offload-to-cpu',
      '--diffusion-fa',
      '--disable-image-metadata'
    ];
    if (request.operation === 'image.edit') {
      const base = files.get(request.baseImage.field);
      if (!base) throw Object.assign(new Error('Base image multipart field is missing.'), { code: 'INVALID_REQUEST' });
      args.push('--ref-image', base.path);
    } else if (request.operation === 'image.inpaint') {
      const base = files.get(request.baseImage.field);
      const selection = files.get(request.selectionMask.field);
      if (!base) throw Object.assign(new Error('Base image multipart field is missing.'), { code: 'INVALID_REQUEST' });
      if (!selection) throw Object.assign(new Error('Selection mask multipart field is missing.'), { code: 'INVALID_REQUEST' });
      args.push('--init-img', base.path, '--mask', selection.path);
    }
    for (const reference of request.references ?? []) {
      const input = files.get(reference.image.field);
      if (!input) throw Object.assign(new Error(`Reference field ${reference.image.field} is missing.`), { code: 'INVALID_REQUEST' });
      args.push('--ref-image', input.path);
    }

    onProgress?.(0.05, 'loading-model');
    await new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-16_384);
        if (/sampling|step/iu.test(String(chunk))) onProgress?.(0.5, 'running');
      });
      const cancel = () => child.kill();
      signal?.addEventListener('abort', cancel, { once: true });
      child.once('error', (error) => reject(Object.assign(error, { code: 'INFERENCE_FAILED' })));
      child.once('exit', (code) => {
        signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) reject(Object.assign(new Error('Job cancelled.'), { code: 'JOB_CANCELLED' }));
        else if (code === 0) resolve();
        else reject(Object.assign(new Error(`sd-cli failed (${code}): ${stderr}`), { code: 'INFERENCE_FAILED' }));
      });
    });

    const images = [];
    for (let index = 1; index <= request.output.count; index += 1) {
      const outputPath = outputPattern.replace('%03d', String(index).padStart(3, '0'));
      const bytes = await readFile(outputPath);
      images.push({ bytes, mimeType: 'image/png', ...pngDimensions(bytes), path: outputPath });
    }
    return images;
  }
}
