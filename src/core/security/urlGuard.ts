import dns from 'node:dns/promises';
import net from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(
    public readonly code: 'INVALID_URL' | 'SSRF_BLOCKED',
    message: string,
  ) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0];
  if (!net.isIP(clean)) return true;

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  const lower = clean.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    return isPrivateOrReservedIp(mapped);
  }
  return false;
}

export function validateExternalFeedUrlSyntax(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new UnsafeUrlError('INVALID_URL', 'Please provide a feed URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError('INVALID_URL', 'Malformed feed URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UnsafeUrlError(
      'INVALID_URL',
      'Only HTTPS and HTTP feed URLs are supported.',
    );
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError(
      'INVALID_URL',
      'Embedded credentials in URLs are not allowed.',
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new UnsafeUrlError(
      'SSRF_BLOCKED',
      'Localhost and internal network URLs are blocked.',
    );
  }

  if (net.isIP(host.replace(/^\[|\]$/g, '')) && isPrivateOrReservedIp(host)) {
    throw new UnsafeUrlError(
      'SSRF_BLOCKED',
      'Private and link-local IP addresses are blocked.',
    );
  }

  return parsed;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = validateExternalFeedUrlSyntax(rawUrl);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new UnsafeUrlError(
        'SSRF_BLOCKED',
        'Private IP destinations are blocked.',
      );
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) {
      throw new UnsafeUrlError('INVALID_URL', 'Could not resolve feed hostname.');
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new UnsafeUrlError(
          'SSRF_BLOCKED',
          'Feed hostname resolves to a private or reserved network address.',
        );
      }
    }
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    throw new UnsafeUrlError(
      'INVALID_URL',
      'Unable to resolve feed hostname.',
    );
  }

  return parsed;
}
