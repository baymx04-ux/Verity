import { describe, expect, it } from 'vitest';

import { sanitizeRedirectUrl } from './redirect';

describe('sanitizeRedirectUrl', () => {
  it('accepts safe relative paths', () => {
    expect(sanitizeRedirectUrl('/chat')).toBe('/chat');
    expect(sanitizeRedirectUrl('/documents')).toBe('/documents');
    expect(sanitizeRedirectUrl('/admin')).toBe('/admin');
  });

  it('preserves query parameters and hashes for safe paths', () => {
    expect(sanitizeRedirectUrl('/documents?tab=recent&sort=desc#top')).toBe(
      '/documents?tab=recent&sort=desc#top',
    );
    expect(sanitizeRedirectUrl('/chat?mode=data')).toBe('/chat?mode=data');
  });

  it('prevents redirect loops by rejecting /login and /login paths', () => {
    expect(sanitizeRedirectUrl('/login')).toBe('/chat');
    expect(sanitizeRedirectUrl('/login?redirect=/admin')).toBe('/chat');
    expect(sanitizeRedirectUrl('/login/reset')).toBe('/chat');
  });

  it('blocks open redirect attempts with external domains', () => {
    expect(sanitizeRedirectUrl('https://evil.com')).toBe('/chat');
    expect(sanitizeRedirectUrl('http://attacker.org/steal')).toBe('/chat');
    expect(sanitizeRedirectUrl('ftp://example.com')).toBe('/chat');
  });

  it('blocks protocol-relative and backslash obfuscated redirects', () => {
    expect(sanitizeRedirectUrl('//evil.com')).toBe('/chat');
    expect(sanitizeRedirectUrl('//evil.com/chat')).toBe('/chat');
    expect(sanitizeRedirectUrl('/\\evil.com')).toBe('/chat');
    expect(sanitizeRedirectUrl('\\evil.com')).toBe('/chat');
    expect(sanitizeRedirectUrl('///evil.com')).toBe('/chat');
  });

  it('blocks javascript and data pseudo-protocols', () => {
    expect(sanitizeRedirectUrl('javascript:alert(1)')).toBe('/chat');
    expect(sanitizeRedirectUrl('data:text/html,<h1>attack</h1>')).toBe('/chat');
  });

  it('blocks CRLF injection attempts', () => {
    expect(sanitizeRedirectUrl('/chat\r\nSet-Cookie: evil=1')).toBe('/chat');
    expect(sanitizeRedirectUrl('/chat\nLocation: https://evil.com')).toBe('/chat');
  });

  it('handles empty, null, or invalid inputs with custom fallback', () => {
    expect(sanitizeRedirectUrl('')).toBe('/chat');
    expect(sanitizeRedirectUrl('   ')).toBe('/chat');
    expect(sanitizeRedirectUrl(null)).toBe('/chat');
    expect(sanitizeRedirectUrl(undefined)).toBe('/chat');
    expect(sanitizeRedirectUrl(12345)).toBe('/chat');
    expect(sanitizeRedirectUrl('', '/documents')).toBe('/documents');
  });
});

