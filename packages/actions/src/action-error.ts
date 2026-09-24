/**
 * Every action throws ActionError instead of returning ad hoc error shapes.
 * Route handlers (v1 and v2 alike) catch this once, at the edge, and map it
 * to an HTTP response — the same error model works for both API versions
 * even though their JSON envelopes differ.
 */
export class ActionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ActionError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthorized(message = "Authentication required"): ActionError {
    return new ActionError(401, "unauthorized", message);
  }

  static forbidden(message = "Permission denied"): ActionError {
    return new ActionError(403, "forbidden", message);
  }

  static notFound(message = "Not found"): ActionError {
    return new ActionError(404, "not_found", message);
  }

  static validation(message: string, details?: unknown): ActionError {
    return new ActionError(400, "validation_error", message, details);
  }
}
