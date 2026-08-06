import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};
const first = (value) => Array.isArray(value) ? value[0] : value;
const validRedirect = (value) => {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('redirect_uris must use HTTPS or an HTTP loopback address.');
  }
  if (url.username || url.password || url.hash) throw new Error('redirect_uris may not contain credentials or fragments.');
  return url.href;
};

export class LightTableOAuthStore {
  constructor({ issuer, resource, pairingCode, now = () => Date.now(), stateStore = null,
    tenantId = 'default', userId = 'owner' }) {
    this.issuer = new URL(issuer);
    this.resource = new URL(resource);
    this.pairingCode = pairingCode;
    this.now = now;
    this.stateStore = stateStore; this.tenantId = tenantId; this.userId = userId;
    const state = stateStore?.load?.() ?? {};
    this.clients = new Map(state.clients ?? []); this.codes = new Map(state.codes ?? []);
    this.tokens = new Map(state.tokens ?? []); this.refresh = new Map(state.refresh ?? []); this.csrf = new Map(state.csrf ?? []);
    this.pairingFailures = new Map(state.pairingFailures ?? []);
    if (!pairingCode || pairingCode.length < 8) throw new Error('LIGHTTABLE_PAIRING_CODE must contain at least 8 characters.');
    this.prune();
  }

  persist() {
    this.stateStore?.save?.({ version: 1, clients: [...this.clients], codes: [...this.codes],
      tokens: [...this.tokens], refresh: [...this.refresh], csrf: [...this.csrf], pairingFailures: [...this.pairingFailures] });
  }

  prune() {
    const now = this.now();
    for (const records of [this.codes, this.tokens, this.refresh, this.csrf]) {
      for (const [key, value] of records) if (value.expiresAt <= now) records.delete(key);
    }
    for (const [key, value] of this.pairingFailures) if (value.windowEnds <= now && value.blockedUntil <= now) this.pairingFailures.delete(key);
    this.persist();
  }

  createCsrf() {
    const token = base64url(randomBytes(24)); this.csrf.set(hash(token), { expiresAt: this.now() + 10 * 60_000 });
    this.persist(); return token;
  }

  consumeCsrf(formToken, cookieToken) {
    if (!formToken || !cookieToken || !equal(formToken, cookieToken)) throw new Error('The authorization form expired.');
    const key = hash(formToken); const record = this.csrf.get(key); this.csrf.delete(key); this.persist();
    if (!record || record.expiresAt <= this.now()) throw new Error('The authorization form expired.');
  }

  register(metadata) {
    if (!metadata || !Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1
      || metadata.redirect_uris.length > 8) throw new Error('redirect_uris must contain 1-8 URLs.');
    const redirectUris = metadata.redirect_uris.map(validRedirect);
    const clientId = base64url(randomBytes(24));
    const client = { client_id: clientId, tenant_id: this.tenantId, user_id: this.userId,
      client_name: String(metadata.client_name ?? 'MCP client').slice(0, 128),
      redirect_uris: redirectUris, token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
    this.clients.set(clientId, client); this.persist();
    return client;
  }

  authorize(input) {
    const client = this.clients.get(input.clientId);
    if (!client || !client.redirect_uris.includes(new URL(input.redirectUri).href)) throw new Error('Unknown client or redirect URI.');
    if (input.responseType !== 'code' || input.codeChallengeMethod !== 'S256' || !input.codeChallenge) {
      throw new Error('Authorization requires code response and PKCE S256.');
    }
    const failure = this.pairingFailures.get(input.clientId);
    if (failure?.blockedUntil > this.now()) throw new Error('Too many invalid pairing attempts. Try again later.');
    if (!equal(input.pairingCode, this.pairingCode)) {
      const recent = failure && failure.windowEnds > this.now() ? failure.count + 1 : 1;
      this.pairingFailures.set(input.clientId, { count: recent,
        windowEnds: this.now() + 10 * 60_000,
        blockedUntil: recent >= 10 ? this.now() + 10 * 60_000 : 0 });
      this.persist(); throw new Error('The pairing code is invalid.');
    }
    this.pairingFailures.delete(input.clientId);
    const requested = new Set(String(input.scope ?? '').split(/\s+/u).filter(Boolean));
    const allowed = ['lighttable:read', 'lighttable:edit', 'offline_access'];
    if ([...requested].some((scope) => !allowed.includes(scope))) throw new Error('An unsupported scope was requested.');
    const code = base64url(randomBytes(32));
    this.codes.set(hash(code), { clientId: input.clientId, tenantId: client.tenant_id, userId: client.user_id,
      redirectUri: new URL(input.redirectUri).href,
      codeChallenge: input.codeChallenge, scopes: [...requested], expiresAt: this.now() + 5 * 60_000 });
    this.persist();
    return code;
  }

  exchangeCode({ code, clientId, redirectUri, codeVerifier }) {
    const key = hash(code); const record = this.codes.get(key); this.codes.delete(key);
    if (!record || record.expiresAt <= this.now() || record.clientId !== clientId
      || record.redirectUri !== new URL(redirectUri).href
      || base64url(createHash('sha256').update(codeVerifier).digest()) !== record.codeChallenge) {
      this.persist(); throw new Error('The authorization code or PKCE verifier is invalid.');
    }
    return this.issue(record.clientId, record.scopes, true, record);
  }

  exchangeRefresh({ refreshToken, clientId }) {
    const key = hash(refreshToken); const record = this.refresh.get(key); this.refresh.delete(key);
    if (!record || record.expiresAt <= this.now() || record.clientId !== clientId) {
      this.persist(); throw new Error('The refresh token is invalid.');
    }
    return this.issue(record.clientId, record.scopes, true, record);
  }

  issue(clientId, scopes, includeRefresh, identity = null) {
    const client = this.clients.get(clientId); const tenantId = identity?.tenantId ?? client?.tenant_id ?? this.tenantId;
    const userId = identity?.userId ?? client?.user_id ?? this.userId;
    const accessToken = base64url(randomBytes(32)); const expiresIn = 3600;
    this.tokens.set(hash(accessToken), { clientId, tenantId, userId, scopes, expiresAt: this.now() + expiresIn * 1000 });
    const result = { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn,
      scope: scopes.join(' ') };
    if (includeRefresh && scopes.includes('offline_access')) {
      const refreshToken = base64url(randomBytes(40));
      this.refresh.set(hash(refreshToken), { clientId, tenantId, userId, scopes, expiresAt: this.now() + 30 * 24 * 3600_000 });
      result.refresh_token = refreshToken;
    }
    this.persist();
    return result;
  }

  async verifyAccessToken(token) {
    const record = this.tokens.get(hash(token));
    if (!record || record.expiresAt <= this.now()) throw new Error('Invalid or expired access token.');
    return { token, clientId: record.clientId, tenantId: record.tenantId, userId: record.userId, scopes: [...record.scopes],
      expiresAt: Math.floor(record.expiresAt / 1000), resource: this.resource };
  }
}

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const installOAuthRoutes = (app, store) => {
  app.use('/oauth', express.urlencoded({ extended: false, limit: '32kb' }));
  app.post('/oauth/register', express.json({ limit: '32kb' }), (req, res) => {
    try { res.status(201).json(store.register(req.body)); }
    catch (error) { res.status(400).json({ error: 'invalid_client_metadata', error_description: error.message }); }
  });
  app.get('/oauth/authorize', (req, res) => {
    const csrf = store.createCsrf();
    const fields = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state',
      'code_challenge', 'code_challenge_method'].map((name) =>
      `<input type="hidden" name="${name}" value="${escapeHtml(first(req.query[name]) ?? '')}">`).join('');
    res.cookie('lt_oauth_csrf', csrf, { httpOnly: true, sameSite: 'lax', secure: store.issuer.protocol === 'https:',
      maxAge: 10 * 60_000, path: '/oauth/authorize' });
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Pair LightTable</title>
      <style>body{font:16px system-ui;max-width:32rem;margin:4rem auto;background:#20242a;color:#eee}input,button{font:inherit;padding:.65rem}input{width:100%;box-sizing:border-box}button{margin-top:1rem}</style>
      <h1>Pair with LightTable</h1><p>Enter the short-lived pairing code shown by the server owner.</p>
      <form method="post" action="/oauth/authorize">${fields}<input type="hidden" name="csrf" value="${csrf}"><label>Pairing code<input name="pairing_code" type="password" required autocomplete="one-time-code"></label><button>Authorize</button></form>`);
  });
  app.post('/oauth/authorize', (req, res) => {
    try {
      const cookie = String(req.headers.cookie ?? '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith('lt_oauth_csrf='))?.slice('lt_oauth_csrf='.length);
      store.consumeCsrf(req.body.csrf, cookie);
      const code = store.authorize({ clientId: req.body.client_id, redirectUri: req.body.redirect_uri,
        responseType: req.body.response_type, scope: req.body.scope,
        codeChallenge: req.body.code_challenge, codeChallengeMethod: req.body.code_challenge_method,
        pairingCode: req.body.pairing_code });
      const redirect = new URL(req.body.redirect_uri); redirect.searchParams.set('code', code);
      if (req.body.state) redirect.searchParams.set('state', req.body.state);
      res.redirect(303, redirect.href);
    } catch (error) { res.status(400).type('text').send(`Authorization failed: ${error.message}`); }
  });
  app.post('/oauth/token', express.urlencoded({ extended: false, limit: '32kb' }), (req, res) => {
    try {
      const result = req.body.grant_type === 'authorization_code'
        ? store.exchangeCode({ code: req.body.code, clientId: req.body.client_id,
          redirectUri: req.body.redirect_uri, codeVerifier: req.body.code_verifier })
        : req.body.grant_type === 'refresh_token'
          ? store.exchangeRefresh({ refreshToken: req.body.refresh_token, clientId: req.body.client_id })
          : (() => { throw new Error('Unsupported grant_type.'); })();
      res.set('cache-control', 'no-store').json(result);
    } catch (error) { res.status(400).json({ error: 'invalid_grant', error_description: error.message }); }
  });
};
