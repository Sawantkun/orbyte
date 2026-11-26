/**
 * Content-Security-Policy for app pages (API content routes set their own,
 * stricter sandbox policy). Scripts: per-request nonce + 'strict-dynamic'.
 * Styles: 'unsafe-inline' because React renders style attributes and UI
 * libraries inject <style> tags without nonces; script injection, the
 * dangerous part, stays blocked.
 */
export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}
