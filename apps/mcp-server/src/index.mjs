import process from 'node:process';
import { LightTableBridgeClient, MockLightTableClient } from './lighttableClient.mjs';
import { createLightTableMcpApp } from './server.mjs';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const host = process.env.HOST ?? '0.0.0.0';
const publicUrl = process.env.LIGHTTABLE_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const allowInsecure = process.env.LIGHTTABLE_ALLOW_INSECURE_HTTP === 'true';
const pairingCode = process.env.LIGHTTABLE_PAIRING_CODE;
if (!pairingCode) throw new Error('LIGHTTABLE_PAIRING_CODE is required.');
if (process.env.LIGHTTABLE_DEMO_MODE !== 'true' && !process.env.LIGHTTABLE_BRIDGE_URL) {
  throw new Error('LIGHTTABLE_BRIDGE_URL is required outside demo mode.');
}
const client = process.env.LIGHTTABLE_DEMO_MODE === 'true'
  ? new MockLightTableClient()
  : new LightTableBridgeClient({ baseUrl: process.env.LIGHTTABLE_BRIDGE_URL,
    token: process.env.LIGHTTABLE_BRIDGE_TOKEN });
const allowedHosts = (process.env.LIGHTTABLE_ALLOWED_HOSTS ?? new URL(publicUrl).hostname)
  .split(',').map((value) => value.trim()).filter(Boolean);
const { app, close } = await createLightTableMcpApp({ publicUrl, pairingCode, client,
  allowInsecure, allowedHosts });
const server = app.listen(port, host, () => {
  process.stdout.write(`LightTable MCP listening at ${new URL('/mcp', publicUrl).href}\n`);
});
const shutdown = () => void close().finally(() => server.close());
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
