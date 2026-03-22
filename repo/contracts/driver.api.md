# Driver Service API Contract

## POST /v1/drivers
Register or update driver profile.

**Request:**
```json
{
  "name": "string",
  "vehicleType": "BIKE"
}
```

**Zod Schema:**
```javascript
const registerDriverSchema = z.object({
  name: z.string().min(2),
  vehicleType: z.enum(["BIKE", "CAR", "VAN"])
});
```

**Response (200 OK):**
```json
{
  "driverId": "uuid-string"
}
```

## POST /v1/drivers/location
Send location update.

**Request:**
```json
{
  "lat": 12.34,
  "lng": 56.78
}
```

**Zod Schema:**
```javascript
const locationUpdateSchema = z.object({
  lat: z.number(),
  lng: z.number()
});
```

**Response (200 OK):**
```json
{
  "success": true
}
```

## POST /v1/drivers/offline
Mark driver as offline.

**Request:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true
}
```