import { spawn } from 'node:child_process';
import path from 'node:path';
import type { LocalAiProviderConfiguration, LocalAiProviderSessionSource } from './localAiConnectionController';

interface LocalAiReadyRecord {
  readonly type: 'ready';
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

export interface LocalAiProcessManagerOptions {
  readonly serviceEntryPath: string;
  readonly executablePath?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly startupTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
}

/**
 * Owns the private loopback inference process. The bearer token crosses only
 * the child-process pipe and this desktop-main boundary; it is never exposed
 * to React, Agent Access, MCP, command payloads or application logs.
 */
export class LocalAiProcessManager implements LocalAiProviderSessionSource {
  private process: ReturnType<typeof spawn> | null = null;
  private configuration: LocalAiProviderConfiguration | null = null;
  private starting: Promise<LocalAiProviderConfiguration> | null = null;

  constructor(private readonly options: LocalAiProcessManagerOptions) {}

  start(): Promise<LocalAiProviderConfiguration> {
    if (this.configuration) return Promise.resolve(this.configuration);
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => { this.starting = null; });
    return this.starting;
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = null;
    this.configuration = null;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const forced = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000);
      child.once('exit', () => { clearTimeout(forced); resolve(); });
      child.kill('SIGTERM');
    });
  }

  private startProcess(): Promise<LocalAiProviderConfiguration> {
    const run = this.options.spawnProcess ?? spawn;
    const executable = this.options.executablePath ?? process.execPath;
    const child = run(executable, [path.resolve(this.options.serviceEntryPath)], {
      env: {
        ...process.env,
        ...this.options.environment,
        ELECTRON_RUN_AS_NODE: '1',
        LIGHTTABLE_LOCAL_AI_HOST: '127.0.0.1',
        LIGHTTABLE_LOCAL_AI_PORT: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;

    return new Promise<LocalAiProviderConfiguration>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const fail = (reason: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (child.exitCode === null) child.kill('SIGTERM');
        this.process = null;
        reject(reason);
      };
      timeout = setTimeout(
        () => fail(new Error('Local AI service startup timed out.')),
        this.options.startupTimeoutMs ?? 15_000
      );

      child.stderr?.on('data', (chunk: Buffer) => {
        // Keep a bounded diagnostic for failures. stdout contains the private
        // token and is deliberately never copied to an error or application log.
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2_000);
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const newline = stdout.indexOf('\n');
        if (newline < 0) return;
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        try {
          const ready = parseReadyRecord(line);
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const configuration = {
            baseUrl: `http://${ready.host}:${ready.port}`,
            apiToken: ready.token
          };
          this.configuration = configuration;
          resolve(configuration);
        } catch (reason) {
          fail(reason instanceof Error ? reason : new Error(String(reason)));
        }
      });
      child.once('error', (reason) => fail(reason));
      child.once('exit', (code) => {
        if (settled) {
          this.process = null;
          this.configuration = null;
          return;
        }
        const detail = stderr.trim() ? ` ${stderr.trim()}` : '';
        fail(new Error(`Local AI service exited during startup (${code ?? 'signal'}).${detail}`));
      });
    });
  }
}

const parseReadyRecord = (line: string): LocalAiReadyRecord => {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Invalid local AI startup record.');
  const record = value as Partial<LocalAiReadyRecord>;
  if (record.type !== 'ready' || record.host !== '127.0.0.1'
    || !Number.isInteger(record.port) || (record.port ?? 0) <= 0
    || typeof record.token !== 'string' || record.token.length < 16) {
    throw new Error('Invalid local AI startup record.');
  }
  return record as LocalAiReadyRecord;
};
