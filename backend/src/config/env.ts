import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // mysql://user:password@host:3306/database (MariaDB). Optional until the app uses the database.
  DATABASE_URL: z
    .string()
    .regex(/^(mysql|mariadb):\/\//)
    .optional(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate environment variables once, at startup.
 * The error lists which keys are wrong but never prints their values (they may be secrets).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report the key and the kind of problem only. Zod messages can echo the rejected value.
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}
