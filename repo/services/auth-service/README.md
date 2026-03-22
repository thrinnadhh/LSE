# Auth Module

## Responsibilities
- User authentication and authorization (login, register)
- Issue JWT access / refresh tokens
- Validate credentials natively against local accounts

## Does NOT handle
- Detailed User Profiles
- User commerce status or addresses

## Dependencies
- DB (users, permissions)
- Redis (session state or ban lists)
- Kafka (N/A)

## Events
- None natively emitted (acts purely as request middleware & isolated handler)