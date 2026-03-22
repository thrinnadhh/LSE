# User Module

## Responsibilities
- C.R.U.D management for End User records and commerce data
- Delivery addresses and user phone registrations
- Role based account states (admin, shop_owner, customer, driver)

## Does NOT handle
- Creating Shops
- Active JWT Authentication decoding (Auth does this)

## Dependencies
- DB (users, user_commerce)
- No complex streaming dependencies

## Events
- user.created.v1