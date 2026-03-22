# Dispatch Module

## Responsibilities
- Queue available orders for immediate delivery orchestration
- Read driver status pool and actively route/assign matches
- Actively react to user purchases to bind assignments

## Does NOT handle
- Order persistence or payment resolution
- Detailed driver historical analysis
- Live websocket real-time coordinates

## Dependencies
- Kafka Producer/Consumer (events from Driver & Order streams)
- Redis (`driver:status:*`, `dispatch:queue:*`)
- order.repo / API interfaces

## Events
- order.dispatch.failed
- order.created (consumes)