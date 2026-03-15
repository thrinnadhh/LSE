const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");

function toApiRole(role) {
  return String(role).toLowerCase();
}

async function getMe({ userId, db }) {
  const result = await db.query(
    `
      SELECT id, phone, email, full_name, role, is_active, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "User not found");
  }

  const user = result.rows[0];
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.full_name,
    role: toApiRole(user.role),
    isActive: user.is_active,
    createdAt: user.created_at,
  };
}

module.exports = { getMe };
