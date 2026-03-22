# Shop Module

## Responsibilities
- C.R.U.D management for Sellers and Geo-Locations
- Maintain operation hours, meta-tags, and shop approval states
- PostGIS locations logic creation

## Does NOT handle
- Creating users

## Dependencies
- DB (shops, shop_locations)
- PostGIS geo-spatial extensions

## Events
- shop.created.v1 (implied boundaries)