import { describe, expect, it } from 'vitest';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/client';
import { resolveHiggsfieldAuthorizationCallback } from './higgsfieldConnection';

const discovery = (overrides: Partial<OAuthDiscoveryState> = {}): OAuthDiscoveryState => ({
  authorizationServerUrl: 'https://mcp.higgsfield.ai',
  authorizationServerMetadata: {
    issuer: 'https://mcp.higgsfield.ai',
    authorization_endpoint: 'https://mcp.higgsfield.ai/oauth2/authorize',
    token_endpoint: 'https://mcp.higgsfield.ai/oauth2/token',
    response_types_supported: ['code']
  },
  resourceMetadata: {
    resource: 'https://mcp.higgsfield.ai/mcp',
    authorization_servers: ['https://mcp.higgsfield.ai'],
    higgsfield_auth_hints: {
      options: [{
        flow: 'authorization_code_pkce',
        authorization_server: 'https://mcp.higgsfield.ai',
        upstream_authorization_server: 'https://clerk.higgsfield.ai'
      }]
    }
  } as OAuthDiscoveryState['resourceMetadata'],
  ...overrides
});

describe('Higgsfield OAuth compatibility', () => {
  it('accepts the declared Clerk upstream issuer without weakening the SDK globally', () => {
    const callback = new URLSearchParams({
      code: 'authorization-code',
      state: 'expected-state',
      iss: 'https://clerk.higgsfield.ai'
    });

    expect(resolveHiggsfieldAuthorizationCallback(callback, discovery())).toBe('authorization-code');
  });

  it.each([
    ['an undeclared upstream', discovery({ resourceMetadata: undefined })],
    ['a different facade', discovery({ authorizationServerUrl: 'https://other.example' })],
    ['different issuer metadata', discovery({
      authorizationServerMetadata: {
        issuer: 'https://other.example',
        authorization_endpoint: 'https://other.example/authorize',
        token_endpoint: 'https://other.example/token',
        response_types_supported: ['code']
      }
    })]
  ])('leaves the callback intact for %s so the SDK rejects it', (_label, state) => {
    const callback = new URLSearchParams({ code: 'authorization-code', iss: 'https://clerk.higgsfield.ai' });
    expect(resolveHiggsfieldAuthorizationCallback(callback, state)).toBe(callback);
  });

  it('leaves unknown issuer mismatches intact for SDK validation', () => {
    const callback = new URLSearchParams({ code: 'authorization-code', iss: 'https://attacker.example' });
    expect(resolveHiggsfieldAuthorizationCallback(callback, discovery())).toBe(callback);
  });

  it('does not bypass validation for error-shaped callbacks', () => {
    const callback = new URLSearchParams({ error: 'access_denied', iss: 'https://clerk.higgsfield.ai' });
    expect(resolveHiggsfieldAuthorizationCallback(callback, discovery())).toBe(callback);
  });
});
