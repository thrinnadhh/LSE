# Tracking Module

## Responsibilities
- Real-time ETA and geolocation mapping back to consumers
- Parse drivers tracking events to populate pubsub
- Websocket router specifically bound for location events and ETA pushes 

## Does NOT handle
- Dispatch logic
- Persisting Driver models and generic Driver profiles

## Dependencies
- DB (analytics events optionally tracking routes)
- Redis PubSub 
- Kafka Consumer (listening for driver streams)

## Events
- No direct producer topics. High volume WS broadcast generator.