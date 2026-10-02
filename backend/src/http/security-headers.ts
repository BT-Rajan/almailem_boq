import type { FastifyInstance } from 'fastify';

/**
 * Security headers on every API response. The API only ever returns JSON or a file download, so
 * its content policy forbids everything. A route that set its own header (the attachment download
 * sets a sandbox CSP) keeps it. The single-page app's own CSP is set by the web server (DEPLOY.md).
 */
const HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function registerSecurityHeaders(app: FastifyInstance, opts: { hsts: boolean }): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(HEADERS))
      if (!reply.hasHeader(name)) void reply.header(name, value);
    if (opts.hsts)
      void reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    return payload;
  });
}
