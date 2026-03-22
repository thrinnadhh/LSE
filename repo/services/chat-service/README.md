# Chat Module

## Responsibilities
- Real-time customer to shop websocket and standard messaging
- Store chat history persistence
- Act as WS message router and manager for interactions

## Does NOT handle
- Global App Notifications
- In-driver order updates

## Dependencies
- WS Server / Upgrade logic
- DB (chats, messages)
- Redis URL (pub/sub sync logic across server instances)

## Events
- No direct external Kafka events (utilizes Redis channels for internal propagation)