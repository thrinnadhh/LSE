import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS_CODE = "123456"
TIMEOUT = 30

def send_otp(phone):
    url = f"{BASE_URL}/auth/send-otp"
    payload = {"phone": phone}
    resp = requests.post(url, json=payload, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp

def verify_otp(phone, otp):
    url = f"{BASE_URL}/auth/verify-otp"
    payload = {"phone": phone, "otp": otp}
    resp = requests.post(url, json=payload, timeout=TIMEOUT)
    resp.raise_for_status()
    json_resp = resp.json()
    assert "accessToken" in json_resp, "accessToken missing in verify response"
    return json_resp["accessToken"]

def create_conversation(token, shop_id):
    url = f"{BASE_URL}/chat/conversations"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"shop_id": shop_id}
    resp = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    resp.raise_for_status()
    json_resp = resp.json()
    assert "conversationId" in json_resp, "conversationId missing in create conversation response"
    return json_resp["conversationId"]

def create_quote(token, conversation_id, items, total):
    url = f"{BASE_URL}/chat/quotes"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "conversationId": conversation_id,
        "items": items,
        "total": total
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    return resp

def create_shop_and_get_owner_jwt(owner_phone):
    # Authenticate owner (send OTP and verify)
    send_otp(owner_phone)
    owner_jwt = verify_otp(owner_phone, OTP_BYPASS_CODE)
    # Create a shop
    url = f"{BASE_URL}/shops"
    headers = {"Authorization": f"Bearer {owner_jwt}"}
    payload = {
        "name": "Test Shop",
        "location": "12.9716,77.5946",
        "category": "testing"
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    resp.raise_for_status()
    json_resp = resp.json()
    assert "shopId" in json_resp, "shopId missing in shop creation response"
    return json_resp["shopId"], owner_jwt

def test_post_chat_conversations_and_quotes_role_based_access():
    cust_phone = "+15550001234"
    owner_phone = "+15550005678"

    # Authenticate customer - get custJWT
    send_otp(cust_phone)
    cust_jwt = verify_otp(cust_phone, OTP_BYPASS_CODE)

    # Authenticate owner - get ownerJWT and create a shop
    shop_id, owner_jwt = create_shop_and_get_owner_jwt(owner_phone)

    conversation_id = None
    quote_id = None

    try:
        # Customer creates a conversation with the shop
        conversation_id = create_conversation(cust_jwt, shop_id)

        # Shop owner creates a quote for that conversation
        items = [
            {"productId": "prod1", "quantity": 2},
            {"productId": "prod2", "quantity": 1}
        ]
        total = 300
        resp = create_quote(owner_jwt, conversation_id, items, total)
        assert resp.status_code == 201, f"Expected 201 for owner quote creation, got {resp.status_code}"
        json_resp = resp.json()
        assert "quoteId" in json_resp, "quoteId missing in create quote response"
        quote_id = json_resp["quoteId"]

        # Customer attempts to create a quote (should be forbidden)
        resp_cust_quote = create_quote(cust_jwt, conversation_id, items, total)
        assert resp_cust_quote.status_code == 403, f"Expected 403 when customer tries to create quote, got {resp_cust_quote.status_code}"
    finally:
        # Cleanup: No explicit delete endpoints given in PRD for conversations or quotes.
        # Assuming resource cleanup is not supported via API or handled differently.
        # If there were delete endpoints, you would delete quote and conversation here.
        pass

test_post_chat_conversations_and_quotes_role_based_access()
