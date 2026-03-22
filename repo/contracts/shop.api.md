# Shop Service API Contract

## POST /v1/shops
Register a new shop.

**Request:**
```json
{
  "name": "string",
  "category": "string",
  "lat": 1.23,
  "lng": 4.56
}
```

**Zod Schema:**
```javascript
const createShopSchema = z.object({
  name: z.string().min(2),
  category: z.string(),
  lat: z.number(),
  lng: z.number()
});
```

**Response (201 OK):**
```json
{
  "shopId": "uuid-string",
  "status": "CREATED"
}
```

## GET /v1/shops/nearby
Find shops near a specific location.

**Query Params:**
- `lat`: Number
- `lng`: Number
- `radius`: Number (optional)

**Response (200 OK):**
```json
{
  "shops": []
}
```

## GET /v1/shops/:shopId
Get shop details.

**Response (200 OK):**
```json
{
  "shopId": "uuid-string",
  "name": "string"
}
```

## PATCH /v1/shops/:shopId/availability
Update shop operational status.

**Request:**
```json
{
  "isOpen": true
}
```

**Zod Schema:**
```javascript
const availabilitySchema = z.object({
  isOpen: z.boolean()
});
```

**Response (200 OK):**
```json
{
  "success": true
}
```