import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { checkOrigin, HttpError } from '../lib/server';

function request(origin?: string, host = '127.0.0.1:3000', url = 'http://127.0.0.1:3000/api/auth') {
  return new NextRequest(url, {
    method: 'POST',
    headers: { host, ...(origin === undefined ? {} : { origin }) },
  });
}

describe('API origin protection', () => {
  it('accepts the documented loopback URL despite NextURL normalization', () => {
    const req = request('http://127.0.0.1:3000');
    expect(req.nextUrl.hostname).toBe('localhost');
    expect(() => checkOrigin(req)).not.toThrow();
  });

  it('accepts localhost and IPv6 when they match the destination host', () => {
    expect(() => checkOrigin(request('http://localhost:3000', 'localhost:3000'))).not.toThrow();
    expect(() => checkOrigin(request('http://[::1]:3000', '[::1]:3000'))).not.toThrow();
  });

  it.each([
    'https://attacker.example',
    'http://127.0.0.1:3001',
    'https://127.0.0.1:3000',
    'http://localhost:3000',
    'null',
    'invalid-url',
  ])('rejects a different or invalid origin: %s', origin => {
    expect(() => checkOrigin(request(origin))).toThrow(HttpError);
    try { checkOrigin(request(origin)); } catch (error) {
      expect((error as HttpError).status).toBe(403);
    }
  });

  it('does not allow a forwarded host to override the destination', () => {
    const req = request('https://attacker.example');
    req.headers.set('x-forwarded-host', 'attacker.example');
    expect(() => checkOrigin(req)).toThrow(HttpError);
  });

  it('preserves requests without an Origin header', () => {
    expect(() => checkOrigin(request())).not.toThrow();
  });
});
