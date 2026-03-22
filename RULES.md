# RULES.md

## Architecture Rules

- DO NOT modify files outside the target module
- Each service owns its data
- Cross-service communication ONLY via Kafka events or APIs
- DO NOT modify event schemas in contracts/
- DO NOT introduce new dependencies without explicit instruction

## Code Change Rules

- Changes must be minimal and localized
- Prefer modifying a single file
- If multiple files are required, explain why

## Event Rules

- All events must include:
  - traceId
  - version (e.g., order.created.v1)
  - timestamp

## Logging Rules

- All logs must be structured JSON
- Must include traceId

## Testing Rules

- Do not break existing tests
- Update tests if behavior changes

## API Rules

- Do NOT modify API contracts without explicit instruction
- All endpoints must match contracts/ files
- Response formats are fixed
- New fields must be backward compatible
- All API and Event endpoints must be explicitly versioned (e.g., `v1`)

## Forbidden

- No global refactors
- No renaming unrelated files
- No changing shared contracts