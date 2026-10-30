/**
 * Validates and sanitizes a redirect destination to prevent open redirect vulnerabilities
 * and redirect loops.
 *
 * Rules:
 * 1. Must be a non-empty string.
 * 2. Must be a relative path starting with a single '/' (not '//' or '/\').
 * 3. Must not point to public auth pages (e.g. '/login') to avoid loops.
 * 4. Must not contain external schemes, credentials, or control characters.
 * 5. Returns fallback (default '/chat') if invalid.
 */
export function sanitizeRedirectUrl(url: unknown, fallback = '/chat'): string {
  if (typeof url !== 'string' || !url.trim()) {
    return fallback;
  }

  const trimmed = url.trim();

  // Prevent protocol-relative URLs (e.g. '//evil.com') and backslash tricks ('/\evil.com' or '\evil.com')
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) {
    return fallback;
  }

  // Must begin with '/'
  if (!trimmed.startsWith('/')) {
    return fallback;
  }

  // Reject newlines, carriage returns, or null bytes (CRLF injection)
  if (/[\r\n\0]/.test(trimmed)) {
    return fallback;
  }

  try {
    // Parse using dummy base to inspect resolved URL components
    const parsed = new URL(trimmed, 'http://localhost');

    // Ensure hostname is localhost (no host spoofing) and protocol is http:
    if (parsed.hostname !== 'localhost' || parsed.protocol !== 'http:') {
      return fallback;
    }

    // Prevent redirect loops: if destination is /login or /login/*, fall back
    if (parsed.pathname === '/login' || parsed.pathname.startsWith('/login/')) {
      return fallback;
    }

    // Reconstruct safe relative path including search params and hash
    const destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return destination;
  } catch {
    return fallback;
  }
}

