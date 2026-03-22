# Chat Service API Contract

## POST /v1/chat/conversations
Create a new chat conversation.

**Request:**
```json
{
  "shopId": "uuid-string"
}
```

**Zod Schema:**
```javascript
const createConversationSchema = z.object({
  shopId: z.string().uuid()
});
```

**Response (201 OK):**
```json
{
  "conversationId": "uuid-string"
}
```

## POST /v1/chat/messages
Send a new message.

**Request:**
```json
{
  "conversationId": "uuid-string",
  "text": "Hello, is this available?"
}
```

**Zod Schema:**
```javascript
const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1)
});
```

**Response (201 OK):**
```json
{
  "messageId": "uuid-string",
  "timestamp": "iso-string"
}
```

## POST /v1/chat/quotes
Create a negotiation quote.

**Request:**
```json
{
  "conversationId": "uuid-string",
  "offerAmount": 500,
  "items": []
}
```

**Zod Schema:**
```javascript
const createQuoteSchema = z.object({
  conversationId: z.string().uuid(),
  offerAmount: z.number().positive(),
  items: z.array(z.any()).optional()
});
```

**Response (201 OK):**
```json
{
  "quoteId": "uuid-string"
}
```