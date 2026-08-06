import { createServer } from 'node:https';
import { describe, expect, it } from 'vitest';
import selfsigned from 'selfsigned';
import { HttpsAgentPairingClient } from './agentTunnelAdapters';

describe('HttpsAgentPairingClient', () => {
  it('observes and pins the TLS server identity even in the local self-signed harness', async () => {
    const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      days: 1, keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]
    });
    const server = createServer({ key: certificate.private, cert: certificate.cert }, (_request, response) => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        serverUrl: '', socketUrl: 'wss://localhost/agent/tunnel', serverId: 'tls-test',
        certificateSha256: '0'.repeat(64), deviceId: 'a'.repeat(24),
        sessionToken: 's'.repeat(43), expiresAt: Date.now() + 60_000
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TLS test address unavailable.');
    const url = `https://localhost:${address.port}`;
    const client = new HttpsAgentPairingClient(true);
    const paired = await client.pair({ serverUrl: url, code: 'PAIR-1', deviceId: 'a'.repeat(24) });
    expect(paired.certificateSha256).toMatch(/^[a-f\d]{64}$/u);
    await expect(client.pair({ serverUrl: url, code: 'PAIR-2', deviceId: 'a'.repeat(24),
      expectedCertificateSha256: '0'.repeat(64) })).rejects.toThrow('pinned identity');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
