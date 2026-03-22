# Home Module

## Responsibilities
- Serve combined personalized storefront "home" configurations
- Implement the Intelligent Ranking Engine algorithms (Behavior/Distance)
- Gather stats, preferences, and aggregate views dynamically

## Does NOT handle
- Individual Product searching or OpenSearch
- Saving or executing transactions
- Analytics consumption

## Dependencies
- DB (shops, shop_customer_stats, user_preferences, PostGIS distance)
- Relies exclusively on static view logic across DB queries

## Events
- Read-only service, no direct Kafka emissions.