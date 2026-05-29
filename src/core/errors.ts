/**
 * Application errors with a stable HTTP status and machine-readable code.
 * Thrown by services and translated uniformly by the REST `onError` handler
 * and the MCP tool wrappers.
 */
export class AppError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class NotFoundError extends AppError {
	constructor(message = "Not found") {
		super(404, "not_found", message);
	}
}

export class ValidationError extends AppError {
	constructor(
		message = "Validation failed",
		readonly details?: unknown,
	) {
		super(400, "validation_error", message);
	}
}

export class UnauthorizedError extends AppError {
	constructor(message = "Unauthorized") {
		super(401, "unauthorized", message);
	}
}

export class ForbiddenError extends AppError {
	constructor(message = "Forbidden") {
		super(403, "forbidden", message);
	}
}

export class ConflictError extends AppError {
	constructor(message = "Conflict") {
		super(409, "conflict", message);
	}
}
