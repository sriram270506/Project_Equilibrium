export class ApplicationError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, 409, details);
    this.name = "ConflictError";
  }
}

export class PolicyError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("POLICY_REJECTION", message, 422, details);
    this.name = "PolicyError";
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message: string = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string = "Forbidden") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class IdempotencyError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("IDEMPOTENCY_CONFLICT", message, 409, details);
    this.name = "IdempotencyError";
  }
}

export class RateLimitError extends ApplicationError {
  constructor(message: string = "Rate limit exceeded") {
    super("RATE_LIMIT_EXCEEDED", message, 429);
    this.name = "RateLimitError";
  }
}

export class InternalError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INTERNAL_ERROR", message, 500, details);
    this.name = "InternalError";
  }
}

export class ServiceUnavailableError extends ApplicationError {
  constructor(message: string = "Service unavailable") {
    super("SERVICE_UNAVAILABLE", message, 503);
    this.name = "ServiceUnavailableError";
  }
}
