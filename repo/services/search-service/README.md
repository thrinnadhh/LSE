# Search Module

## Responsibilities
- Natural language and keyword OpenSearch resolution
- Ingest asynchronous product/category changes to indexing engines
- Provide faceted filters (distance, categories, ratings)

## Does NOT handle
- The creation logic of actual stores or products.

## Dependencies
- OpenSearch Client/Instance
- DB (Syncing/re-indexing views offline)
- Kafka Consumer (reads product changes)

## Events
- none directly produced (heavy consumer bounds)