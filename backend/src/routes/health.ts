import type { FastifyInstance } from 'fastify';
import { okResponse } from '@boq/shared';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', { config: { public: true } }, () => okResponse({ status: 'ok' as const }));
}
