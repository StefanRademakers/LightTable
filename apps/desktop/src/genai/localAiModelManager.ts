import { spawn } from 'node:child_process';

export interface LocalAiModelStatus {
  readonly modelId: string; readonly displayName: string; readonly directory: string;
  readonly ready: boolean; readonly installing: boolean;
  readonly installedBytes: number; readonly totalBytes: number;
  readonly files: readonly { readonly filename: string; readonly bytes: number;
    readonly installed: boolean; readonly valid: boolean }[];
  readonly currentFile?: string; readonly error?: string;
}

export class LocalAiModelManager {
  private installPromise: Promise<LocalAiModelStatus> | null = null;
  private lastStatus: LocalAiModelStatus | null = null;
  private readonly listeners = new Set<(status: LocalAiModelStatus) => void>();

  constructor(private readonly options: {
    readonly modelCliPath: string; readonly modelDirectory: string; readonly executablePath?: string;
  }) {}

  subscribe(listener: (status: LocalAiModelStatus) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  async status(): Promise<LocalAiModelStatus> {
    if (this.installPromise && this.lastStatus) return this.lastStatus;
    return this.publish({ ...await this.run('status'), installing: false });
  }

  install(): Promise<LocalAiModelStatus> {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.run('install', (record) => {
      if (record.type !== 'progress') return;
      const totalBytes = this.lastStatus?.totalBytes ?? record.total ?? 0;
      const completedBefore = this.lastStatus?.files.slice(0, record.fileIndex)
        .reduce((sum, file) => sum + file.bytes, 0) ?? 0;
      this.publish({ ...(this.lastStatus ?? emptyStatus(this.options.modelDirectory, totalBytes)),
        installing: true, currentFile: record.file,
        installedBytes: Math.min(totalBytes, completedBefore + record.received), totalBytes });
    }).then((record) => this.publish({ ...record, installing: false, currentFile: undefined }))
      .catch((reason) => this.publish({ ...(this.lastStatus ?? emptyStatus(this.options.modelDirectory, 0)),
        installing: false, error: reason instanceof Error ? reason.message : String(reason) }))
      .finally(() => { this.installPromise = null; });
    return this.installPromise;
  }

  private run(command: 'status' | 'install', onRecord?: (record: any) => void): Promise<any> {
    const child = spawn(this.options.executablePath ?? process.execPath,
      [this.options.modelCliPath, command, this.options.modelDirectory], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
      });
    return new Promise((resolve, reject) => {
      let stdout = ''; let stderr = ''; let finalRecord: any;
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        let newline = stdout.indexOf('\n');
        while (newline >= 0) {
          const line = stdout.slice(0, newline).trim(); stdout = stdout.slice(newline + 1);
          if (line) {
            try {
              const record = JSON.parse(line); onRecord?.(record);
              if (record.type === 'status' || record.type === 'complete') finalRecord = record;
            } catch (reason) {
              child.kill();
              reject(new Error(`Local AI model manager returned invalid output: ${reason instanceof Error ? reason.message : String(reason)}`));
              return;
            }
          }
          newline = stdout.indexOf('\n');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 && finalRecord ? resolve(finalRecord)
        : reject(new Error(stderr.trim() || `Local AI model command failed (${code ?? 'signal'}).`)));
    });
  }

  private publish(status: LocalAiModelStatus): LocalAiModelStatus {
    this.lastStatus = status; for (const listener of this.listeners) listener(status); return status;
  }
}

const emptyStatus = (directory: string, totalBytes: number): LocalAiModelStatus => ({
  modelId: 'flux-2-klein-4b', displayName: 'FLUX.2 Klein 4B', directory,
  ready: false, installing: false, installedBytes: 0, totalBytes, files: []
});
