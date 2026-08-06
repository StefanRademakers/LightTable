import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAccessCredentials, AgentAccessCredentialStore } from './agentAccessBridge';

export interface CredentialProtector {
  available(): boolean;
  protect(value: string): Uint8Array;
  unprotect(value: Uint8Array): string;
}

const createCredentials = (): AgentAccessCredentials => ({
  deviceId: randomBytes(12).toString('hex'),
  token: randomBytes(32).toString('base64url')
});
const createToken = (): string => randomBytes(32).toString('base64url');

const valid = (value: unknown): value is AgentAccessCredentials => Boolean(
  value && typeof value === 'object'
  && /^[a-f\d]{24}$/u.test((value as AgentAccessCredentials).deviceId)
  && /^[A-Za-z\d_-]{40,}$/u.test((value as AgentAccessCredentials).token)
);

export class DesktopAgentAccessCredentialStore implements AgentAccessCredentialStore {
  constructor(private readonly filePath: string, private readonly protector: CredentialProtector) {}

  async loadOrCreate(): Promise<AgentAccessCredentials> {
    if (!this.protector.available()) throw new Error('OS-protected credential storage is unavailable.');
    try {
      const parsed: unknown = JSON.parse(this.protector.unprotect(new Uint8Array(await readFile(this.filePath))));
      if (valid(parsed)) return parsed;
    } catch {
      // Missing, corrupt or no longer decryptable credentials are replaced.
    }
    return this.persist(createCredentials());
  }

  async rotate(): Promise<AgentAccessCredentials> {
    if (!this.protector.available()) return Promise.reject(new Error('OS-protected credential storage is unavailable.'));
    const current = await this.loadOrCreate();
    return this.persist({ ...current, token: createToken() });
  }

  private async persist(credentials: AgentAccessCredentials): Promise<AgentAccessCredentials> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this.protector.protect(JSON.stringify(credentials)), { mode: 0o600 });
    return credentials;
  }
}
