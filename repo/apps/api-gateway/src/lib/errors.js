const logger = require("../../../../src/logger");

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  logger.error({
    traceId: _req.traceId,
    event: "http.unhandled_error",
    error: err.message,
    stack: err.stack,
  });

  return res.status(500).json({
    error: "Internal server error",
  });
}

module.exports = { ApiError, asyncHandler, errorHandler };
