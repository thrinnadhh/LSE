# Auth Service API Contract

## POST /v1/auth/send-otp
Send an OTP to the user's phone for login or registration.

**Request:**
```json
{
  "phone": "+1234567890"
}
```

**Zod Schema:**
```javascript
const sendOtpSchema = z.object({
  phone: z.string().min(10)
});
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "OTP sent"
}
```

## POST /v1/auth/verify-otp
Verify the previously sent OTP.

**Request:**
```json
{
  "phone": "+1234567890",
  "otp": "123456"
}
```

**Zod Schema:**
```javascript
const verifyOtpSchema = z.object({
  phone: z.string().min(10),
  otp: z.string().length(6)
});
```

**Response (200 OK):**
```json
{
  "token": "jwt-token-string",
  "refreshToken": "jwt-refresh-token",
  "userId": "uuid-string"
}
```

## POST /v1/auth/refresh-token
Refresh an expired JWT token.

**Request:**
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

**Zod Schema:**
```javascript
const refreshTokenSchema = z.object({
  refreshToken: z.string()
});
```

**Response (200 OK):**
```json
{
  "token": "new-jwt-token-string"
}
```