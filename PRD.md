# 📄 PRODUCT REQUIREMENTS DOCUMENT (PRD)

## 🏷 Product Name

**LocalSearchEngine (LSE)**
*A hyperlocal commerce and discovery platform*

---

# 🎯 1. PRODUCT VISION

Build a **City Operating System** where users can:

* Discover nearby shops
* Search products/services in real-time
* Interact with shop owners
* Order seamlessly
* Get personalized recommendations

👉 Not just e-commerce — **real-world commerce digitization**

---

# 🚀 2. PROBLEM STATEMENT

### Current Issues:

* Local shops are **not digitally discoverable**
* Users rely on:

  * Google Maps (limited product-level search)
  * Word-of-mouth
* No **real-time availability + interaction**

---

# 💡 3. SOLUTION

A platform that connects:

```text
Customer ↔ Shop ↔ Product ↔ Interaction ↔ Order
```

With:

* Smart search
* Real-time communication
* Personalized recommendations
* Local-first experience

---

# 👥 4. USERS

## 4.1 Customers

* Search products nearby
* Discover shops
* Order items
* Get recommendations

## 4.2 Shop Owners

* List shop & products
* Respond to customer queries
* Send quotes
* Track sales & analytics

## 4.3 Drivers (future)

* Deliver orders
* Update live location

---

# 🧩 5. CORE FEATURES

---

## 🔐 5.1 AUTH SYSTEM

* OTP-based login
* Roles:

  * customer
  * shop_owner
  * driver
  * admin
* JWT authentication

---

## 🏪 5.2 SHOP MANAGEMENT

* Create shop
* Categories (grocery, food, pet, etc.)
* Location-based discovery
* Owner linkage

---

## 📦 5.3 PRODUCT SYSTEM

* Add products/services
* Price + stock
* Category tagging

---

## 🔍 5.4 SEARCH SYSTEM (CRITICAL CORE)

### Features:

* Keyword-based search
* Multi-word matching
* Product + shop + category search
* Fallback (never empty)

### Output:

```json
{
  "shopId": "...",
  "name": "...",
  "deliveryTag": "Nearby"
}
```

---

## 💬 5.5 CONVERSATION SYSTEM

* Customer initiates conversation
* Linked to shop
* Enables negotiation flow

---

## 💰 5.6 QUOTE SYSTEM

Flow:

```text
Customer → Request → Shop Owner → Quote → Accept
```

* Owner sends quote
* Customer accepts

---

## 🧾 5.7 ORDER SYSTEM

Flow:

```text
Quote → Accept → Order → Delivered
```

* Order creation
* Status tracking
* Dev-mode auto completion

---

## 🧠 5.8 PERSONALIZATION ENGINE

Inputs:

* Search history
* Orders
* Shop interactions

Outputs:

* Recommended shops
* Regular shops

---

## 🏠 5.9 HOME API

Returns:

```json
{
  "favorites": [],
  "regularShops": [],
  "recommended": [],
  "categories": []
}
```

---

## ⭐ 5.10 FAVORITES

* Save shops
* Quick access

---

## 📊 5.11 SHOP DASHBOARD

Metrics:

* totalOrders
* revenue
* repeatCustomers
* topProducts

---

# 🔄 6. KEY WORKFLOWS

---

## 🧑‍💻 Customer Journey

```text
Search → View Shop → Chat → Quote → Accept → Order → Repeat
```

---

## 🏪 Shop Owner Journey

```text
Create Shop → Add Products → Respond → Send Quote → Earn Revenue
```

---

## 🔁 Growth Loop (VERY IMPORTANT)

```text
Search → Order → Data → Personalization → Better Results → More Orders
```

---

# 🧪 7. EDGE CASE HANDLING

* Redis failure → OTP fallback
* Empty search → fallback shops
* Duplicate requests → safe handling
* Invalid token → 401

---

# ⚡ 8. PERFORMANCE REQUIREMENTS

* Search < 100ms
* Home API < 200ms
* No blocking external calls

---

# 🗄 9. DATA MODELS (HIGH LEVEL)

## Users

* id
* phone
* role

## Shops

* id
* owner_id
* name
* location

## Products

* id
* shop_id
* name
* price

## Quotes

* id
* conversation_id
* items

## Orders

* id
* shop_id
* customer_id
* status

## Stats

* shop_customer_stats
* order_count
* last_order_at

---

# 🧱 10. SYSTEM ARCHITECTURE

* Microservices:

  * auth-service
  * user-service
  * shop-service
  * product-service
  * order-service
  * search-service
  * home-service
* API Gateway
* PostgreSQL
* Redis
* Kafka (optional future)

---

# 🚧 11. CURRENT STATUS

## ✅ Completed

* Auth
* Search
* Home API
* Shop + Product
* Quote flow (partial)
* Dashboard (partial)

## ❌ In Progress

* Order lifecycle stability
* Personalization accuracy
* Repeat tracking consistency

---

# 🚀 12. FUTURE ROADMAP

## Phase 14+

* Real-time tracking
* Notifications
* AI recommendations
* Voice search
* Geo-fencing

---

# 🧠 13. UNIQUE VALUE

Unlike traditional platforms:

```text
Not catalog-first
But discovery + interaction-first
```

---

# 🎯 14. SUCCESS METRICS

* Search → Order conversion rate
* Repeat customer rate
* Avg response time
* Daily active users

---

# 🏁 CONCLUSION

LocalSearchEngine is not just a product.

It is:

```text
A foundation for digitizing local commerce ecosystems
```

---

**Status:** MVP nearing completion
**Next milestone:** Stable order lifecycle + real personalization
