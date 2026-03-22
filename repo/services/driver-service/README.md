# Driver Module

## Responsibilities
- Driver registration, management, and online/offline status reporting
- Ingest driver GPS location uploads
- Provide interfaces for looking up active drivers

## Does NOT handle
- Map routing formulas or ETA parsing
- The assignment engine logic (handled by dispatch)

## Dependencies
- DB (drivers, telemetry)
- Redis (`driver:status:*`)
- Kafka Producer

## Events
- driver.location.updated.v1
- driver.online.v1
- driver.offline.v1