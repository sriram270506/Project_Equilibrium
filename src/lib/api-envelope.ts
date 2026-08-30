export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ErrorDetails {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  success: false;
  error: ErrorDetails;
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data,
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ErrorEnvelope {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
}
