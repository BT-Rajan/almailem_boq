import { expect, it } from 'vitest';
import { hasTestDb } from './testing';

// CI sets REQUIRE_DB_TESTS=1 so that a missing database fails the run instead of silently skipping.
it.runIf(process.env['REQUIRE_DB_TESTS'] === '1')('TEST_DATABASE_URL is configured', () => {
  expect(hasTestDb).toBe(true);
});
