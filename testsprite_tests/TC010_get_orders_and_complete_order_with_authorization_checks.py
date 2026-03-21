import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30

# Phones for auth flows
CUST_PHONE = "+15550000001"
OTHER_PHONE = "+15550000002"
OWNER_PHONE = "+15550000003"  # For shop owner and creating resources
OTP_BYPASS_CODE = "123456"

def send_otp(phone):
    resp = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": phone}, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp

def verify_otp(phone, otp):
    resp = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["accessToken"]

def create_shop(owner_jwt):
    headers = {"Authorization": f"Bearer {owner_jwt}"}
    shop_data = {
        "name": "Test Shop",
        "location": {"latitude": 12.9716, "longitude": 77.5946},
        "category": "test category"
    }
    resp = requests.post(f"{BASE_URL}/shops", headers=headers, json=shop_data, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["shopId"]

def create_product(owner_jwt, shop_id):
    headers = {"Authorization": f"Bearer {owner_jwt}"}
    product_data = {
        "shop_id": shop_id,
        "name": "Test Product",
        "price": 10.0,
        "stock": 5,
        "category": "test category"
    }
    resp = requests.post(f"{BASE_URL}/products", headers=headers, json=product_data, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["productId"]

def create_conversation(cust_jwt, shop_id):
    headers = {"Authorization": f"Bearer {cust_jwt}"}
    resp = requests.post(f"{BASE_URL}/chat/conversations", headers=headers, json={"shop_id": shop_id}, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["conversationId"]

def create_quote(owner_jwt, conversation_id):
    headers = {"Authorization": f"Bearer {owner_jwt}"}
    quote_data = {
        "conversationId": conversation_id,
        "items": [{"productId": "p1", "quantity": 1}],
        "total": 10.0
    }
    resp = requests.post(f"{BASE_URL}/chat/quotes", headers=headers, json=quote_data, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["quoteId"]

def accept_quote(cust_jwt, quote_id):
    headers = {"Authorization": f"Bearer {cust_jwt}"}
    resp = requests.post(f"{BASE_URL}/chat/quotes/{quote_id}/accept", headers=headers, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["orderId"]

def test_get_orders_and_complete_order_authorization_checks():
    # Authenticate customer and other user to get JWTs
    send_otp(CUST_PHONE)
    cust_jwt = verify_otp(CUST_PHONE, OTP_BYPASS_CODE)
    send_otp(OTHER_PHONE)
    other_jwt = verify_otp(OTHER_PHONE, OTP_BYPASS_CODE)

    # Authenticate shop owner to create resources
    send_otp(OWNER_PHONE)
    owner_jwt = verify_otp(OWNER_PHONE, OTP_BYPASS_CODE)

    shop_id = None
    order_id = None

    try:
        shop_id = create_shop(owner_jwt)
        product_id = create_product(owner_jwt, shop_id)

        # Create conversation as customer with the shop
        conversation_id = create_conversation(cust_jwt, shop_id)

        # Create quote as shop owner
        headers_owner = {"Authorization": f"Bearer {owner_jwt}"}
        quote_data = {
            "conversationId": conversation_id,
            "items": [{"productId": product_id, "quantity": 1}],
            "total": 10.0
        }
        quote_resp = requests.post(f"{BASE_URL}/chat/quotes", headers=headers_owner, json=quote_data, timeout=TIMEOUT)
        quote_resp.raise_for_status()
        quote_id = quote_resp.json()["quoteId"]

        # Accept quote as customer to create order
        headers_cust = {"Authorization": f"Bearer {cust_jwt}"}
        accept_resp = requests.post(f"{BASE_URL}/chat/quotes/{quote_id}/accept", headers=headers_cust, timeout=TIMEOUT)
        accept_resp.raise_for_status()
        order_id = accept_resp.json()["orderId"]

        # 1. Test GET /orders/:orderId with authorized user JWT (customer)
        headers_cust = {"Authorization": f"Bearer {cust_jwt}"}
        get_order_resp = requests.get(f"{BASE_URL}/orders/{order_id}", headers=headers_cust, timeout=TIMEOUT)
        assert get_order_resp.status_code == 200, f"Expected 200 OK but got {get_order_resp.status_code}"
        order_details = get_order_resp.json()
        assert "status" in order_details, "Order details missing 'status' field"

        # 2. Test GET /orders/:orderId with unauthorized JWT (other user)
        headers_other = {"Authorization": f"Bearer {other_jwt}"}
        get_order_unauth_resp = requests.get(f"{BASE_URL}/orders/{order_id}", headers=headers_other, timeout=TIMEOUT)
        assert get_order_unauth_resp.status_code == 403, f"Expected 403 Forbidden but got {get_order_unauth_resp.status_code}"

        # 3. Test POST /orders/:orderId/complete with proper authorization and dev flag
        complete_headers = {"Authorization": f"Bearer {cust_jwt}"}
        complete_resp = requests.post(f"{BASE_URL}/orders/{order_id}/complete?dev=true", headers=complete_headers, timeout=TIMEOUT)
        assert complete_resp.status_code == 200, f"Expected 200 OK but got {complete_resp.status_code}"
        complete_data = complete_resp.json()
        assert complete_data.get("status") == "COMPLETED", f"Expected status COMPLETED but got {complete_data.get('status')}"

        # 4. Test POST /orders/:orderId/complete without dev flag should get 403 forbidden
        complete_no_flag_resp = requests.post(f"{BASE_URL}/orders/{order_id}/complete", headers=complete_headers, timeout=TIMEOUT)
        assert complete_no_flag_resp.status_code == 403, f"Expected 403 Forbidden but got {complete_no_flag_resp.status_code}"

        # 5. Test POST /orders/:orderId/complete with unauthorized user should get 403 forbidden
        complete_unauth_resp = requests.post(f"{BASE_URL}/orders/{order_id}/complete?dev=true", headers=headers_other, timeout=TIMEOUT)
        assert complete_unauth_resp.status_code == 403, f"Expected 403 Forbidden but got {complete_unauth_resp.status_code}"

    finally:
        # Cleanup: There is no delete order endpoint mentioned.
        # We can attempt to delete shop to clean up (assuming it deletes products and dependent data).
        if shop_id:
            try:
                del_headers = {"Authorization": f"Bearer {owner_jwt}"}
                requests.delete(f"{BASE_URL}/shops/{shop_id}", headers=del_headers, timeout=TIMEOUT)
            except Exception:
                pass  # Ignore cleanup errors


test_get_orders_and_complete_order_authorization_checks()
