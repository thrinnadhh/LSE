# Product Service API Contract

## POST /v1/products
Create a new product in the catalog.

**Request:**
```json
{
  "shopId": "uuid-string",
  "name": "string",
  "description": "string",
  "price": 100,
  "category": "string"
}
```

**Zod Schema:**
```javascript
const createProductSchema = z.object({
  shopId: z.string().uuid(),
  name: z.string().min(2),
  description: z.string().optional(),
  price: z.number().positive(),
  category: z.string()
});
```

**Response (201 Created):**
```json
{
  "productId": "uuid-string"
}
```

## GET /v1/products/:productId
Get specific product details.

**Response (200 OK):**
```json
{
  "productId": "uuid-string",
  "name": "string",
  "price": 100
}
```

## GET /v1/shops/:shopId/products
List all products for a specific shop.

**Response (200 OK):**
```json
{
  "items": []
}
```