import type { FastifyInstance } from 'fastify';
import { okResponse } from '@boq/shared';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', () => okResponse({ status: 'ok' as const }));
}
