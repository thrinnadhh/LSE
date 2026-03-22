# Product Module

## Responsibilities
- C.R.U.D management for shop SKUs
- Hold categorical pricing and image data records
- Sync updates down to the search indices
- Inventory availability 

## Does NOT handle
- End user cart caching
- Search tokenization or natural language query mappings

## Dependencies
- DB (products, product_inventory)
- Kafka Producer 

## Events
- product.created.v1
- product.updated.v1
- product.deleted.v1