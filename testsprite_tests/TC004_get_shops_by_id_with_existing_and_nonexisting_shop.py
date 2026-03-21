import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS_CODE = "123456"
TIMEOUT = 30

def authenticate_owner(phone: str):
    # Step 1: send OTP
    resp = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": phone}, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Failed to send OTP: {resp.text}"
    # Step 2: verify OTP with bypass code
    resp = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": phone, "otp": OTP_BYPASS_CODE}, timeout=TIMEOUT)
    assert resp.status_code == 200, f"Failed to verify OTP: {resp.text}"
    token = resp.json().get("accessToken")
    assert token, "No accessToken in response"
    return token

def create_shop(auth_token: str, name="Test Shop TC004", location="Test Location", category="grocery"):
    headers = {"Authorization": f"Bearer {auth_token}"}
    payload = {
        "name": name,
        "location": location,
        "category": category
    }
    resp = requests.post(f"{BASE_URL}/shops", json=payload, headers=headers, timeout=TIMEOUT)
    assert resp.status_code == 201, f"Shop creation failed: {resp.text}"
    shop_id = resp.json().get("shopId")
    assert shop_id, "No shopId in create shop response"
    return shop_id

def delete_shop(shop_id):
    pass

def test_get_shops_by_id_with_existing_and_nonexisting_shop():
    owner_phone = "+10000000001"  # unique test phone
    auth_token = authenticate_owner(owner_phone)
    shop_id = None

    try:
        # Create a new shop to get an existing shop ID
        shop_id = create_shop(auth_token)

        # Test GET /shops/:id with existing shop ID, no auth required
        resp = requests.get(f"{BASE_URL}/shops/{shop_id}", timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200 for existing shop, got {resp.status_code}"
        data = resp.json()
        # Validate returned fields
        assert isinstance(data, dict), "Shop details response is not a dict"
        assert "shopId" in data and isinstance(data["shopId"], str), "shopId missing or invalid in response"
        assert data.get("shopId") == shop_id, "shopId in response does not match requested ID"
        # Check fields exist and are strings
        assert "name" in data and isinstance(data["name"], str), "name missing or invalid in response"
        assert "location" in data, "location missing in response"
        assert "category" in data, "category missing in response"

        # Test GET /shops/:id with nonexisting shop ID
        nonexisting_id = "00000000-0000-0000-0000-000000000000"
        resp = requests.get(f"{BASE_URL}/shops/{nonexisting_id}", timeout=TIMEOUT)
        assert resp.status_code == 404, f"Expected 404 for nonexisting shop, got {resp.status_code}"

    finally:
        if shop_id:
            delete_shop(shop_id)


test_get_shops_by_id_with_existing_and_nonexisting_shop()
