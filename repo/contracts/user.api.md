# User Service API Contract

## GET /v1/users/me
Get current user profile.

**Response (200 OK):**
```json
{
  "userId": "uuid-string",
  "name": "string",
  "phone": "string"
}
```

## GET /v1/users/preferences
Get user personalization preferences.

**Response (200 OK):**
```json
{
  "notifications": true,
  "theme": "dark"
}
```

## GET /v1/users/favorites
List user's favorite shops.

**Response (200 OK):**
```json
{
  "shops": [
    {
      "shopId": "uuid-string",
      "name": "string"
    }
  ]
}
```

## POST /v1/users/favorites/:shopId
Add a shop to favorites.

**Request:**
```json
{}
```

**Zod Schema:**
```javascript
const addFavoriteSchema = z.object({
  shopId: z.string().uuid()
}); // Param level
```

**Response (200 OK):**
```json
{
  "success": true
}
```

## DELETE /v1/users/favorites/:shopId
Remove shop from favorites.

**Response (200 OK):**
```json
{
  "success": true
}
```