export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  /**
   * Build an error that the HTTP error handler turns into a response.
   *
   * @remarks `message` equals `code`. `details` fields go into the response body beside `error`. A
   * board error puts the UI copy in `code` and the variant in `details.code`.
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

export class UnauthorizedError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(401, code, details);
  }
}

export class ForbiddenError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(403, code, details);
  }
}

export class PolicyError extends HttpError {
  /**
   * Build the 403 for a request that a board policy refuses.
   *
   * @remarks `reason` goes in `details`, so the error handler puts it in the body beside `error`.
   */
  constructor(reason: string, details?: Record<string, unknown>) {
    super(403, "policy-refused", { ...details, reason });
  }
}

export class ConflictError extends HttpError {
  constructor(code: string, details?: Record<string, unknown>) {
    super(409, code, details);
  }
}

export class BoardValidationError extends ValidationError {
  /**
   * Build a board refusal that names its variant beside the client copy.
   *
   * @remarks `error` carries the copy the form shows as is, and `code` carries the variant a client
   * switches on. A variant with no UI copy uses the variant as the copy.
   */
  constructor(
    variant: string,
    copy: string = variant,
    details?: Record<string, unknown>,
  ) {
    super(copy, { code: variant, ...details });
  }
}

export class BoardNotFoundError extends NotFoundError {
  constructor(variant: string) {
    super(variant, { code: variant });
  }
}

export class BoardConflictError extends ConflictError {
  constructor(
    variant: string,
    copy: string = variant,
    details?: Record<string, unknown>,
  ) {
    super(copy, { code: variant, ...details });
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
