import { describe, expect, it } from 'vitest';
import { envelopeSchema, healthSchema } from '@boq/shared';
import { buildApp } from '../../backend/src/app';
import { loadEnv } from '../../backend/src/config/env';

/** The backend response must satisfy the schema the frontend will parse it with. */
describe('health contract', () => {
  it('backend output parses with the shared envelope schema', async () => {
    const app = await buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }));
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(envelopeSchema(healthSchema).safeParse(res.json()).success).toBe(true);
    await app.close();
  });
});
