/** The one error type thrown on purpose by application code. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', message, 404);
  }
  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, 400, details);
  }
  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message, 401);
  }
  static forbidden(message = 'Not allowed'): AppError {
    return new AppError('FORBIDDEN', message, 403);
  }
  static rateLimited(message = 'Too many attempts. Try again later.'): AppError {
    return new AppError('RATE_LIMITED', message, 429);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, 409, details);
  }
}
