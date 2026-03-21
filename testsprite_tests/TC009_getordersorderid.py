import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS = "123456"
TIMEOUT = 30

def test_getordersorderid():
    cust_phone = "+15550001111"
    owner_phone = "+15550002222"
    headers = {"Content-Type": "application/json"}

    cust_jwt = None
    owner_jwt = None
    conversation_id = None
    quote_id = None
    order_id = None

    try:
        # Authenticate customer and get JWT
        resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": cust_phone, "otp": OTP_BYPASS},
            timeout=TIMEOUT,
            headers=headers,
        )
        assert resp.status_code == 200, f"Customer verify-otp failed: {resp.text}"
        cust_jwt = resp.json().get("accessToken")
        assert cust_jwt, "Customer accessToken missing"

        # Authenticate owner and get JWT
        resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": owner_phone, "otp": OTP_BYPASS},
            timeout=TIMEOUT,
            headers=headers,
        )
        assert resp.status_code == 200, f"Owner verify-otp failed: {resp.text}"
        owner_jwt = resp.json().get("accessToken")
        assert owner_jwt, "Owner accessToken missing"

        # Customer creates a conversation with shop_id 1 (assumed to exist)
        resp = requests.post(
            f"{BASE_URL}/chat/conversations",
            json={"shop_id": 1},
            headers={"Authorization": f"Bearer {cust_jwt}", "Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200, f"Create conversation failed: {resp.text}"
        conversation_id = resp.json().get("conversationId")
        assert conversation_id, "conversationId missing"

        # Owner creates a quote for the conversation with dummy item
        items = [{"productId": 1, "quantity": 1, "price": 10.0}]
        total = 10.0
        resp = requests.post(
            f"{BASE_URL}/chat/quotes",
            json={"conversationId": conversation_id, "items": items, "total": total},
            headers={"Authorization": f"Bearer {owner_jwt}", "Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 201, f"Create quote failed: {resp.text}"
        quote_id = resp.json().get("quoteId")
        assert quote_id, "quoteId missing"

        # Customer accepts the quote to create an order
        resp = requests.post(
            f"{BASE_URL}/chat/quotes/{quote_id}/accept",
            headers={"Authorization": f"Bearer {cust_jwt}", "Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 201, f"Accept quote failed: {resp.text}"
        order_id = resp.json().get("orderId")
        assert order_id, "orderId missing"

        # Retrieve order details with customer JWT
        resp = requests.get(
            f"{BASE_URL}/orders/{order_id}",
            headers={"Authorization": f"Bearer {cust_jwt}"},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200, f"Get order failed: {resp.text}"
        order_data = resp.json()
        assert "orderId" in order_data and order_data["orderId"] == order_id
        assert "status" in order_data
        assert "items" in order_data and isinstance(order_data["items"], list)

    finally:
        # Cleanup: no explicit delete order endpoint, so skip
        pass

test_getordersorderid()