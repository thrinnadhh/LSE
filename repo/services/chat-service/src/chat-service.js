const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");

const createConversationSchema = z.object({
  shopId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
});

async function ensureChatTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES users(id),
      shop_id UUID NOT NULL REFERENCES shops(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(customer_id, shop_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages(conversation_id, created_at DESC);
  `);
}

function mapConversation(row) {
  return {
    id: row.id,
    conversationId: row.id,
    customerId: row.customer_id,
    shopId: row.shop_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    messageId: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    message: row.message,
    createdAt: row.created_at,
  };
}

async function createOrGetConversation({ body, auth, db }) {
  const input = createConversationSchema.parse(body);

  const shopCheck = await db.query(
    `
      SELECT id
      FROM shops
      WHERE id = $1
      LIMIT 1
    `,
    [input.shopId]
  );

  if (shopCheck.rowCount === 0) {
    throw new ApiError(404, "Shop not found");
  }

  const created = await db.query(
    `
      INSERT INTO conversations (customer_id, shop_id)
      VALUES ($1, $2)
      ON CONFLICT (customer_id, shop_id)
      DO UPDATE SET updated_at = conversations.updated_at
      RETURNING id, customer_id, shop_id, created_at, updated_at
    `,
    [auth.sub, input.shopId]
  );

  return mapConversation(created.rows[0]);
}

async function getConversationParticipants({ conversationId, db }) {
  const result = await db.query(
    `
      SELECT
        c.id,
        c.customer_id,
        c.shop_id,
        COALESCE(s.owner_user_id, s.owner_id) AS shop_owner_id
      FROM conversations c
      JOIN shops s ON s.id = c.shop_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [conversationId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Conversation not found");
  }

  return {
    conversationId: result.rows[0].id,
    customerId: result.rows[0].customer_id,
    shopId: result.rows[0].shop_id,
    shopOwnerId: result.rows[0].shop_owner_id,
  };
}

function assertConversationParticipant({ authUserId, participants }) {
  if (authUserId !== participants.customerId && authUserId !== participants.shopOwnerId) {
    throw new ApiError(403, "You are not allowed in this conversation");
  }
}

async function getConversationMessages({ conversationId, auth, db }) {
  const participants = await getConversationParticipants({ conversationId, db });
  assertConversationParticipant({ authUserId: auth.sub, participants });

  const result = await db.query(
    `
      SELECT id, conversation_id, sender_id, message, created_at
      FROM (
        SELECT id, conversation_id, sender_id, message, created_at
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      ) latest
      ORDER BY created_at ASC
    `,
    [conversationId]
  );

  return result.rows.map(mapMessage);
}

async function sendMessage({ body, auth, db }) {
  const input = sendMessageSchema.parse(body);
  const participants = await getConversationParticipants({ conversationId: input.conversationId, db });

  assertConversationParticipant({ authUserId: auth.sub, participants });

  const inserted = await db.query(
    `
      INSERT INTO messages (conversation_id, sender_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, conversation_id, sender_id, message, created_at
    `,
    [input.conversationId, auth.sub, input.message]
  );

  await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [input.conversationId]);

  return {
    message: mapMessage(inserted.rows[0]),
    participants,
  };
}

module.exports = {
  ensureChatTables,
  createOrGetConversation,
  getConversationMessages,
  sendMessage,
};
