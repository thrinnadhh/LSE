import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30
OTP = "123456"


def test_postchatconversations():
    cust_phone = "+15555550101"
    shop_owner_phone = "+15555550202"

    headers = {"Content-Type": "application/json"}

    cust_token = None
    owner_token = None
    shop_id = None

    try:
        # Step 1: Authenticate customer and get JWT
        resp = requests.post(
            f"{BASE_URL}/auth/send-otp", json={"phone": cust_phone}, timeout=TIMEOUT
        )
        assert resp.status_code == 200

        resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": cust_phone, "otp": OTP},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        cust_token = resp.json().get("accessToken")
        assert cust_token is not None
        cust_auth_headers = {"Authorization": f"Bearer {cust_token}", "Content-Type": "application/json"}

        # Step 2: Authenticate shop owner and get JWT
        resp = requests.post(
            f"{BASE_URL}/auth/send-otp", json={"phone": shop_owner_phone}, timeout=TIMEOUT
        )
        assert resp.status_code == 200

        resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": shop_owner_phone, "otp": OTP},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        owner_token = resp.json().get("accessToken")
        assert owner_token is not None
        owner_auth_headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}

        # Step 3: Create a new shop with valid owner JWT
        shop_payload = {
            "name": "Test Shop for Conversation",
            "location": "123 Test St, Test City",
            "category": "TestCategory"
        }
        resp = requests.post(
            f"{BASE_URL}/shops",
            headers=owner_auth_headers,
            json=shop_payload,
            timeout=TIMEOUT,
        )
        assert resp.status_code == 201
        shop_id = resp.json().get("shopId")
        assert shop_id is not None

        # Step 4: Create conversation between customer and shop
        conv_payload = {"shop_id": shop_id}
        resp = requests.post(
            f"{BASE_URL}/chat/conversations",
            headers=cust_auth_headers,
            json=conv_payload,
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        conversation_id = resp.json().get("conversationId")
        assert conversation_id is not None

    finally:
        if shop_id and owner_token:
            # Clean up: delete the created shop (assuming DELETE /shops/:id requires owner auth)
            try:
                requests.delete(
                    f"{BASE_URL}/shops/{shop_id}",
                    headers=owner_auth_headers,
                    timeout=TIMEOUT,
                )
            except Exception:
                pass


test_postchatconversations()
