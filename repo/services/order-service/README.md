# Order Module

## Responsibilities
- Handle order lifecycle
- Emit order.created, order.cancelled, order.assigned, order.delivered
- Coordinate transactional DB bounds on state updates

## Does NOT handle
- Payments
- Delivery dispatching logic

## Dependencies
- DB (orders, order_items, side-effect analytic tables)
- Redis (`order:status:*`)
- Kafka producer

## Events
- order.created.v1
- order.status_changed.v1