# Search Service API Contract

## GET /v1/search/products
Search for products across shops.

**Query Params:**
- `q`: string
- `lat`: number
- `lng`: number
- `limit`: number

**Zod Schema (Query):**
```javascript
const searchProductsQuerySchema = z.object({
  q: z.string().min(1),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  limit: z.coerce.number().int().optional()
});
```

**Response (200 OK):**
```json
{
  "results": []
}
```

## GET /v1/search/shops
Search for shops.

**Query Params:**
- `q`: string
- `lat`: number
- `lng`: number

**Response (200 OK):**
```json
{
  "results": []
}
```