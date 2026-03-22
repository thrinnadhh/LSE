# Order Service API Contract

## POST /v1/orders
Create a new order.

**Request:**
```json
{
  "shopId": "string",
  "items": [
    {
      "productId": "string",
      "quantity": 1
    }
  ]
}
```

**Zod Schema:**
```javascript
import { z } from "zod";

const createOrderSchema = z.object({
  shopId: z.string().uuid(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive()
    })
  ).min(1)
});
```

**Response (201 Created):**
```json
{
  "orderId": "string",
  "status": "CREATED",
  "totalAmount": 1500
}
```

## GET /v1/orders/:orderId
Get details of a specific order.

**Response (200 OK):**
```json
{
  "orderId": "string",
  "status": "CREATED",
  "shopId": "string",
  "totalAmount": 1500,
  "items": []
}
```

## PATCH /v1/orders/:orderId/driver
Assign a driver to an order.

**Request:**
```json
{
  "driverId": "string"
}
```

**Zod Schema:**
```javascript
const assignDriverSchema = z.object({
  driverId: z.string().uuid()
});
```

**Response (200 OK):**
```json
{
  "success": true,
  "status": "DRIVER_ASSIGNED"
}
```

## PATCH /v1/orders/:orderId/status
Update the status of an order.

**Request:**
```json
{
  "status": "CONFIRMED"
}
```

**Zod Schema:**
```javascript
const updateOrderStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "PICKED_UP", "OUT_FOR_DELIVERY", "COMPLETED"])
});
```

**Response (200 OK):**
```json
{
  "success": true,
  "status": "CONFIRMED"
}
```