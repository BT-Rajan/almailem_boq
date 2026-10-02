import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { errorResponse, okResponse } from '@boq/shared';
import type { DbPool } from '../db/pool';
import { pingDatabase } from '../db/ping';

/** Liveness: the process is up. Public, no dependencies. */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', { config: { public: true } }, () => okResponse({ status: 'ok' as const }));
}

/**
 * Readiness: the app can serve requests (database answers, attachment store is writable).
 * Public for load balancers; it says only ready or not, never why.
 */
export function registerReadyRoute(
  app: FastifyInstance,
  deps: { pool: DbPool; attachmentsDir: string },
): void {
  const storeWritable = async () => {
    try {
      await mkdir(deps.attachmentsDir, { recursive: true, mode: 0o700 });
      await access(deps.attachmentsDir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  app.get('/api/ready', { config: { public: true } }, async (request, reply) => {
    const [db, store] = await Promise.all([pingDatabase(deps.pool), storeWritable()]);
    if (db && store) return okResponse({ status: 'ready' as const });
    request.log.warn({ db, store }, 'not ready');
    return reply.code(503).send(errorResponse({ code: 'NOT_READY', message: 'Not ready' }));
  });
}
