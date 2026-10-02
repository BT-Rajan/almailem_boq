import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { errorResponse, MoneyError } from '@boq/shared';
import { AppError } from './app-error';

/** Maps every failure to the shared envelope. Unknown errors never leak internals. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    void reply
      .code(404)
      .send(
        errorResponse({ code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` }),
      );
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      void reply.code(err.status).send(
        errorResponse({
          code: err.code,
          message: err.message,
          ...(err.details !== undefined && { details: err.details }),
        }),
      );
      return;
    }

    // An amount or total beyond the safe integer range. Never echo the value.
    if (err instanceof MoneyError) {
      void reply
        .code(400)
        .send(errorResponse({ code: 'AMOUNT_OUT_OF_RANGE', message: 'Amount is out of range' }));
      return;
    }

    if (err instanceof ZodError) {
      void reply.code(400).send(
        errorResponse({
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }),
      );
      return;
    }

    // Fastify's own client errors (bad JSON, payload too large, ...)
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status === 413 || status === 415) {
      void reply
        .code(status)
        .send(
          errorResponse(
            status === 413
              ? { code: 'PAYLOAD_TOO_LARGE', message: 'The file is too large' }
              : { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type' },
          ),
        );
      return;
    }
    if (status >= 400 && status < 500) {
      void reply
        .code(status)
        .send(
          errorResponse({ code: 'BAD_REQUEST', message: 'The request could not be processed' }),
        );
      return;
    }

    req.log.error({ err }, 'unhandled error');
    void reply
      .code(500)
      .send(errorResponse({ code: 'INTERNAL_ERROR', message: 'Something went wrong' }));
  });
}
