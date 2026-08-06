const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export class DeviceTunnelLightTableClient {
  constructor({ broker, deviceId, clientId, clientName = 'LightTable MCP', scopes = ['read', 'edit'] }) {
    this.broker = broker; this.deviceId = deviceId; this.clientId = clientId;
    this.clientName = clientName; this.scopes = scopes;
    if (!/^[a-f\d]{24}$/iu.test(deviceId)) throw new Error('LIGHTTABLE_DEVICE_ID must be a 24-character hex identity.');
    if (!clientId || clientId.length > 128) throw new Error('LIGHTTABLE_CLIENT_ID is invalid.');
  }

  ensureClient() {
    const client = this.broker.status(this.deviceId).clients.find(({ id }) => id === this.clientId);
    if (!client) {
      this.broker.requestClient(this.deviceId, { id: this.clientId, name: this.clientName, scopes: this.scopes });
      throw new Error('client-approval-required');
    }
    if (!client.approved) throw new Error('client-approval-required');
  }

  async invoke(method, parameters = {}) { this.ensureClient(); return this.broker.invoke(this.deviceId, this.clientId, method, parameters); }

  async uploadArtifact({ bytes, name, mediaType }) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES) {
      throw new Error('Agent artifact must contain 1 byte to 32 MiB.');
    }
    return this.invoke('artifact.register', { name, mediaType, bytesBase64: Buffer.from(bytes).toString('base64') });
  }

  async readArtifact(artifactId) {
    const value = await this.invoke('artifact.resolve', { artifactId });
    if (!value || typeof value.bytesBase64 !== 'string') throw new Error('artifact-not-found');
    const bytes = new Uint8Array(Buffer.from(value.bytesBase64, 'base64'));
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('Agent artifact exceeds 32 MiB.');
    return { bytes, name: value.name, mediaType: value.mediaType };
  }
}
