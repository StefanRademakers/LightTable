import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAiProviderClient } from '@lighttable/genai-local';
import { LocalAiProcessManager } from './localAiProcessManager';

const managers: LocalAiProcessManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map((manager) => manager.stop())); });

describe('LocalAiProcessManager', () => {
  it('starts an authenticated service on a private dynamic loopback port', async () => {
    const manager = new LocalAiProcessManager({
      executablePath: process.execPath,
      serviceEntryPath: path.resolve(process.cwd(), '../local-ai-provider/src/cli.mjs'),
      environment: { LIGHTTABLE_LOCAL_AI_FAKE: 'true' }
    });
    managers.push(manager);

    const configuration = await manager.start();
    expect(configuration.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(configuration.apiToken).toMatch(/^[a-f0-9]{48}$/);
    await expect(new LocalAiProviderClient(configuration).health()).resolves.toMatchObject({ status: 'ready' });
    await expect(new LocalAiProviderClient({ baseUrl: configuration.baseUrl }).health()).rejects.toThrow('401');
  });

  it('deduplicates concurrent starts and can restart after stop', async () => {
    const manager = new LocalAiProcessManager({
      executablePath: process.execPath,
      serviceEntryPath: path.resolve(process.cwd(), '../local-ai-provider/src/cli.mjs'),
      environment: { LIGHTTABLE_LOCAL_AI_FAKE: 'true' }
    });
    managers.push(manager);
    const [first, same] = await Promise.all([manager.start(), manager.start()]);
    expect(same).toEqual(first);
    await manager.stop();
    const restarted = await manager.start();
    expect(restarted.apiToken).not.toBe(first.apiToken);
  });
});
