export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  /**
   * Build an error that the HTTP error handler turns into a response.
   *
   * @remarks `message` equals `code`. `details` fields go into the response body beside `error`.
   */
  constructor(status: number, code: string, details?: Record<string, unknown>) {
    super(code);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(400, code, details);
  }
}

export class NotFoundError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(404, code, details);
  }
}

export class ConflictError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(409, code, details);
  }
}

export class UpstreamError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(502, code, details);
  }
}

export class InternalError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(500, code, details);
  }
}
