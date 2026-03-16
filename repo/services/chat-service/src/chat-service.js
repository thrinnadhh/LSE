const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");

const createConversationSchema = z.object({
  shopId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
});

const createQuoteSchema = z.object({
  conversationId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1),
        price: z.coerce.number().positive(),
      })
    )
    .min(1),
});

const acceptQuoteSchema = z.object({
  quoteId: z.string().uuid(),
});

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

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

  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS order_id UUID;`);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_customer_shop_active
    ON conversations(customer_id, shop_id)
    WHERE order_id IS NULL;
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

  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES users(id);`);
  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS message TEXT;`);
  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_user_id UUID REFERENCES users(id);`);
  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT;`);
  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
        BEGIN
          ALTER TABLE messages ADD COLUMN IF NOT EXISTS type message_type NOT NULL DEFAULT 'TEXT';
        EXCEPTION WHEN undefined_object THEN
          NULL;
        END;
      ELSE
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'TEXT';
      END IF;
    END $$;
  `);

  await db.query(`UPDATE messages SET sender_id = sender_user_id WHERE sender_id IS NULL AND sender_user_id IS NOT NULL;`);
  await db.query(`UPDATE messages SET message = body WHERE message IS NULL AND body IS NOT NULL;`);
  await db.query(`UPDATE messages SET created_at = sent_at WHERE created_at IS NULL AND sent_at IS NOT NULL;`);

  await db.query(`ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;`);
  await db.query(`ALTER TABLE messages ALTER COLUMN message SET NOT NULL;`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages(conversation_id, created_at DESC);
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_status') THEN
        CREATE TYPE quote_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
      END IF;
    END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      shop_id UUID NOT NULL REFERENCES shops(id),
      customer_id UUID NOT NULL REFERENCES users(id),
      status quote_status NOT NULL DEFAULT 'PENDING',
      total_price NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_quotes_conversation_id
    ON quotes(conversation_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quote_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      subtotal NUMERIC(12,2) NOT NULL
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id
    ON quote_items(quote_id);
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

function mapQuote(row) {
  return {
    quoteId: row.id,
    status: row.status,
    totalPrice: Number(row.total_price),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      ON CONFLICT (customer_id, shop_id) WHERE order_id IS NULL
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
        c.created_at,
        c.updated_at,
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
        SELECT
          m.id,
          m.conversation_id,
          COALESCE(m.sender_id, m.sender_user_id) AS sender_id,
          COALESCE(m.message, m.body) AS message,
          COALESCE(m.created_at, m.sent_at) AS created_at
        FROM messages m
        WHERE m.conversation_id = $1
        ORDER BY COALESCE(m.created_at, m.sent_at) DESC
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
      INSERT INTO messages (conversation_id, sender_id, sender_user_id, message, body, type, metadata, created_at, sent_at)
      VALUES ($1, $2, $2, $3, $3, 'TEXT', '{}'::jsonb, NOW(), NOW())
      RETURNING id, conversation_id, sender_id, message, created_at
    `,
    [input.conversationId, auth.sub, input.message]
  );

  await db.query(`UPDATE conversations SET updated_at = NOW(), last_message_at = NOW() WHERE id = $1`, [input.conversationId]);

  return {
    message: mapMessage(inserted.rows[0]),
    participants,
  };
}

async function createQuote({ body, auth, db }) {
  if (normalizeRole(auth.role) !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can create quotes");
  }

  const input = createQuoteSchema.parse(body);
  const participants = await getConversationParticipants({
    conversationId: input.conversationId,
    db,
  });

  if (participants.shopOwnerId !== auth.sub) {
    throw new ApiError(403, "Only shop owner of this conversation can create quotes");
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const productsResult = await db.query(
    `
      SELECT id, name
      FROM products
      WHERE shop_id = $1
        AND id = ANY($2::uuid[])
    `,
    [participants.shopId, productIds]
  );

  const productsById = new Map(productsResult.rows.map((row) => [row.id, row.name]));

  if (productsById.size !== productIds.length) {
    throw new ApiError(400, "One or more products are invalid for this shop");
  }

  const computedItems = input.items.map((item) => {
    const subtotal = Number(item.quantity) * Number(item.price);
    return {
      productId: item.productId,
      productName: productsById.get(item.productId),
      quantity: Number(item.quantity),
      price: Number(item.price),
      subtotal,
    };
  });

  const totalPrice = computedItems.reduce((sum, item) => sum + item.subtotal, 0);

  await db.query("BEGIN");
  try {
    const createdQuote = await db.query(
      `
        INSERT INTO quotes (conversation_id, shop_id, customer_id, status, total_price, created_at, updated_at)
        VALUES ($1, $2, $3, 'PENDING', $4, NOW(), NOW())
        RETURNING id, status, total_price, created_at, updated_at
      `,
      [input.conversationId, participants.shopId, participants.customerId, totalPrice]
    );

    const quoteId = createdQuote.rows[0].id;

    for (const item of computedItems) {
      await db.query(
        `
          INSERT INTO quote_items (quote_id, product_id, product_name, quantity, price, subtotal)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [quoteId, item.productId, item.productName, item.quantity, item.price, item.subtotal]
      );
    }

    await db.query("COMMIT");

    return {
      quoteId,
      totalPrice: Number(createdQuote.rows[0].total_price),
      status: createdQuote.rows[0].status,
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function listConversationQuotes({ conversationId, auth, db }) {
  const participants = await getConversationParticipants({ conversationId, db });
  assertConversationParticipant({ authUserId: auth.sub, participants });

  const quotesResult = await db.query(
    `
      SELECT id, status, total_price, created_at, updated_at
      FROM quotes
      WHERE conversation_id = $1
      ORDER BY created_at DESC
    `,
    [conversationId]
  );

  if (quotesResult.rowCount === 0) {
    return [];
  }

  const quoteIds = quotesResult.rows.map((row) => row.id);
  const itemsResult = await db.query(
    `
      SELECT quote_id, product_name, quantity, price, subtotal
      FROM quote_items
      WHERE quote_id = ANY($1::uuid[])
      ORDER BY id ASC
    `,
    [quoteIds]
  );

  const itemsByQuoteId = new Map();
  for (const row of itemsResult.rows) {
    if (!itemsByQuoteId.has(row.quote_id)) {
      itemsByQuoteId.set(row.quote_id, []);
    }

    itemsByQuoteId.get(row.quote_id).push({
      productName: row.product_name,
      quantity: Number(row.quantity),
      price: Number(row.price),
      subtotal: Number(row.subtotal),
    });
  }

  return quotesResult.rows.map((row) => ({
    ...mapQuote(row),
    items: itemsByQuoteId.get(row.id) || [],
  }));
}

async function acceptQuote({ quoteId, auth, db }) {
  const input = acceptQuoteSchema.parse({ quoteId });

  await db.query("BEGIN");
  try {
    const quoteResult = await db.query(
      `
        SELECT id, conversation_id, customer_id, shop_id, status, total_price
        FROM quotes
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [input.quoteId]
    );

    if (quoteResult.rowCount === 0) {
      throw new ApiError(404, "Quote not found");
    }

    const quote = quoteResult.rows[0];
    const participants = await getConversationParticipants({
      conversationId: quote.conversation_id,
      db,
    });

    if (participants.customerId !== auth.sub) {
      throw new ApiError(403, "Only customer of this conversation can accept quotes");
    }

    if (quote.status !== "PENDING") {
      throw new ApiError(400, "Only pending quotes can be accepted");
    }

    await db.query(
      `
        UPDATE quotes
        SET status = 'ACCEPTED', updated_at = NOW()
        WHERE id = $1
      `,
      [input.quoteId]
    );

    const addressResult = await db.query(
      `
        SELECT id
        FROM user_addresses
        WHERE user_id = $1
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1
      `,
      [participants.customerId]
    );

    let deliveryAddressId;
    if (addressResult.rowCount > 0) {
      deliveryAddressId = addressResult.rows[0].id;
    } else {
      const createdAddress = await db.query(
        `
          INSERT INTO user_addresses (user_id, label, line1, city, state, postal_code, location, is_default, created_at)
          VALUES ($1, 'Default', 'Quote checkout address', 'Hyderabad', 'Telangana', '500001', ST_SetSRID(ST_MakePoint(78.4867, 17.385), 4326)::geography, TRUE, NOW())
          RETURNING id
        `,
        [participants.customerId]
      );
      deliveryAddressId = createdAddress.rows[0].id;
    }

    await db.query(
      `
        INSERT INTO global_products (id, name, normalized_name, category, is_active, created_at, updated_at)
        SELECT qi.product_id, qi.product_name, LOWER(qi.product_name), p.category, TRUE, NOW(), NOW()
        FROM quote_items qi
        LEFT JOIN products p ON p.id = qi.product_id
        WHERE qi.quote_id = $1
        ON CONFLICT (id) DO NOTHING
      `,
      [input.quoteId]
    );

    await db.query(
      `
        INSERT INTO shop_inventory (shop_id, global_product_id, display_name, price, stock_qty, updated_at)
        SELECT q.shop_id, qi.product_id, qi.product_name, qi.price, GREATEST(qi.quantity, 1), NOW()
        FROM quote_items qi
        JOIN quotes q ON q.id = qi.quote_id
        WHERE qi.quote_id = $1
        ON CONFLICT (shop_id, global_product_id)
        DO UPDATE SET price = EXCLUDED.price, updated_at = NOW()
      `,
      [input.quoteId]
    );

    const orderResult = await db.query(
      `
        INSERT INTO orders (
          customer_id,
          shop_id,
          delivery_address_id,
          status,
          subtotal,
          delivery_fee,
          platform_fee,
          discount_total,
          grand_total,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'CREATED', $4, 0, 0, 0, $4, NOW(), NOW())
        RETURNING id, status
      `,
      [participants.customerId, quote.shop_id, deliveryAddressId, quote.total_price]
    );

    const orderId = orderResult.rows[0].id;

    await db.query(
      `
        INSERT INTO order_items (
          order_id,
          inventory_id,
          product_name,
          qty,
          unit_price,
          final_price,
          line_total
        )
        SELECT
          $2,
          si.id,
          qi.product_name,
          qi.quantity,
          qi.price,
          qi.price,
          qi.subtotal
        FROM quote_items qi
        JOIN quotes q ON q.id = qi.quote_id
        JOIN shop_inventory si
          ON si.shop_id = q.shop_id
         AND si.global_product_id = qi.product_id
        WHERE qi.quote_id = $1
      `,
      [input.quoteId, orderId]
    );

    await db.query(`UPDATE conversations SET order_id = $2, updated_at = NOW() WHERE id = $1`, [quote.conversation_id, orderId]);

    await db.query("COMMIT");

    return {
      orderId,
      status: orderResult.rows[0].status,
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

module.exports = {
  ensureChatTables,
  createOrGetConversation,
  getConversationMessages,
  sendMessage,
  createQuote,
  listConversationQuotes,
  acceptQuote,
};
