import process from 'node:process';
import { LightTableBridgeClient, MockLightTableClient } from './lighttableClient.mjs';
import { createLightTableMcpApp } from './server.mjs';
import { EncryptedJsonFileStore, MemoryStateStore } from './durableState.mjs';
import { createStructuredLogger, PrivacyAuditLog, validateServiceConfig } from './operations.mjs';
import { DeviceTunnelLightTableClient } from './deviceTunnelClient.mjs';

const config = validateServiceConfig(process.env);
const { port, host, publicUrl, insecure: allowInsecure, allowedHosts } = config;
const pairingCode = process.env.LIGHTTABLE_PAIRING_CODE;
const logger = createStructuredLogger();
const client = process.env.LIGHTTABLE_DEMO_MODE === 'true'
  ? new MockLightTableClient()
  : process.env.LIGHTTABLE_DEVICE_ID
    ? (broker) => new DeviceTunnelLightTableClient({ broker, deviceId: process.env.LIGHTTABLE_DEVICE_ID,
      clientId: process.env.LIGHTTABLE_CLIENT_ID ?? 'lighttable-mcp', clientName: 'LightTable MCP server' })
    : new LightTableBridgeClient({ baseUrl: process.env.LIGHTTABLE_BRIDGE_URL,
      token: process.env.LIGHTTABLE_BRIDGE_TOKEN });
const oauthStateStore = process.env.LIGHTTABLE_STATE_PATH
  ? new EncryptedJsonFileStore({ path: `${process.env.LIGHTTABLE_STATE_PATH}.oauth`, secret: process.env.LIGHTTABLE_STATE_SECRET })
  : new MemoryStateStore();
const auditStateStore = process.env.LIGHTTABLE_STATE_PATH
  ? new EncryptedJsonFileStore({ path: `${process.env.LIGHTTABLE_STATE_PATH}.audit`, secret: process.env.LIGHTTABLE_STATE_SECRET })
  : new MemoryStateStore();
const audit = new PrivacyAuditLog({ stateStore: auditStateStore });
const { app, close, deviceTunnel } = await createLightTableMcpApp({ publicUrl, pairingCode, client,
  allowInsecure, allowedHosts, devicePairingCode: process.env.LIGHTTABLE_DEVICE_PAIRING_CODE ?? pairingCode,
  serverId: process.env.LIGHTTABLE_SERVER_ID ?? 'lighttable-mcp', oauthStateStore, audit,
  tenantId: process.env.LIGHTTABLE_TENANT_ID ?? 'default', userId: process.env.LIGHTTABLE_USER_ID ?? 'owner' });
const server = app.listen(port, host, () => {
  logger.info('server.listening', { endpoint: new URL('/mcp', publicUrl).href });
});
server.on('upgrade', (request, socket, head) => {
  if (!deviceTunnel.handleUpgrade(request, socket, head)) socket.destroy();
});
let stopping = false;
const shutdown = (signal) => {
  if (stopping) return; stopping = true; logger.info('server.stopping', { signal });
  const force = setTimeout(() => { logger.error('server.shutdown-timeout'); process.exitCode = 1; server.closeAllConnections?.(); }, 10_000);
  force.unref();
  void close().catch((error) => logger.error('server.close-failed', { error: error.message }))
    .finally(() => server.close(() => { clearTimeout(force); logger.info('server.stopped'); }));
};
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
