const authService = require("../../auth-service/src/auth-service");

function authenticateToken(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "AUTH token is required" };
  }

  try {
    const decoded = authService.verifyAccessToken(token);
    return {
      ok: true,
      auth: {
        userId: decoded.sub,
        role: String(decoded.role || "").toLowerCase(),
      },
    };
  } catch (_err) {
    return { ok: false, error: "Invalid or expired token" };
  }
}

module.exports = { authenticateToken };
