import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30
OTP_BYPASS_CODE = "123456"

def test_post_chat_quotes_accept_valid_and_invalid_quote_ids():
    cust_phone = "+15550000001"
    owner_phone = "+15550000002"

    def send_otp(phone):
        resp = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": phone}, timeout=TIMEOUT)
        assert resp.status_code == 200
        return resp

    def verify_otp(phone, otp):
        resp = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "accessToken" in data
        return data["accessToken"]

    # Authenticate customer and shop owner
    send_otp(cust_phone)
    cust_jwt = verify_otp(cust_phone, OTP_BYPASS_CODE)
    send_otp(owner_phone)
    owner_jwt = verify_otp(owner_phone, OTP_BYPASS_CODE)

    headers_cust = {"Authorization": f"Bearer {cust_jwt}"}
    headers_owner = {"Authorization": f"Bearer {owner_jwt}"}

    # Create a shop to create conversation
    shop_payload = {"name": "Test Shop for Quotes", "location": {"lat": "12.9716", "lon": "77.5946"}, "category": "TestCategory"}
    resp_shop = requests.post(f"{BASE_URL}/shops", json=shop_payload, headers=headers_owner, timeout=TIMEOUT)
    assert resp_shop.status_code == 201
    shop_id = resp_shop.json().get("shopId")
    assert shop_id is not None

    # Create conversation (customer with shop)
    conv_payload = {"shopId": shop_id}
    resp_conv = requests.post(f"{BASE_URL}/chat/conversations", json=conv_payload, headers=headers_cust, timeout=TIMEOUT)
    assert resp_conv.status_code == 200
    conversation_id = resp_conv.json().get("conversationId")
    assert conversation_id is not None

    # Shop owner creates a quote for this conversation
    quote_payload = {
        "conversationId": conversation_id,
        "items": [
            {"productName": "Sample Product", "quantity": 1, "price": 9.99}
        ],
        "total": 9.99
    }
    resp_quote = requests.post(f"{BASE_URL}/chat/quotes", json=quote_payload, headers=headers_owner, timeout=TIMEOUT)
    assert resp_quote.status_code == 201
    quote_id = resp_quote.json().get("quoteId")
    assert quote_id is not None

    # Test valid quote acceptance by customer -> Should create order
    resp_accept_valid = requests.post(f"{BASE_URL}/chat/quotes/{quote_id}/accept", headers=headers_cust, timeout=TIMEOUT)
    assert resp_accept_valid.status_code == 201
    data_valid = resp_accept_valid.json()
    assert "orderId" in data_valid
    order_id = data_valid["orderId"]
    assert order_id is not None

    # Test acceptance with nonexistent quoteId -> Should 404
    fake_quote_id = "00000000-0000-0000-0000-000000000000"
    resp_accept_invalid = requests.post(f"{BASE_URL}/chat/quotes/{fake_quote_id}/accept", headers=headers_cust, timeout=TIMEOUT)
    assert resp_accept_invalid.status_code == 404


test_post_chat_quotes_accept_valid_and_invalid_quote_ids()
