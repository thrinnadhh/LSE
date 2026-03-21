import requests
import uuid

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30
OTP_CODE = "123456"

def test_getshopsid():
    # Step 1: Register a shop owner and create shop to get a shopId
    owner_phone = f"+100000000{str(uuid.uuid4().int)[:4]}"
    shop_id = None

    try:
        # Send OTP to owner phone
        resp = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": owner_phone}, timeout=TIMEOUT)
        assert resp.status_code == 200

        # Verify OTP to get owner JWT token
        resp = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": owner_phone, "otp": OTP_CODE}, timeout=TIMEOUT)
        assert resp.status_code == 200
        owner_jwt = resp.json().get("accessToken")
        assert isinstance(owner_jwt, str) and owner_jwt != ""

        # Create shop with Authorization header
        headers = {"Authorization": f"Bearer {owner_jwt}"}
        shop_data = {
            "name": "Test Shop TC004",
            "location": "123 Test St, Test City",
            "category": "Books"
        }
        resp = requests.post(f"{BASE_URL}/shops", json=shop_data, headers=headers, timeout=TIMEOUT)
        assert resp.status_code == 201
        shop_id = resp.json().get("shopId")
        assert isinstance(shop_id, str) and shop_id != ""

        # Step 2: Retrieve shop details without authentication
        resp = requests.get(f"{BASE_URL}/shops/{shop_id}", timeout=TIMEOUT)
        assert resp.status_code == 200
        shop = resp.json()

        # Validate shop details match what was created
        assert shop.get("name") == shop_data["name"]
        assert shop.get("location") == shop_data["location"]
        assert shop.get("category") == shop_data["category"]
        assert shop.get("shopId") == shop_id

    finally:
        # Cleanup: delete the created shop if possible (if DELETE endpoint was known)
        # Since no DELETE endpoint is documented, skipping actual deletion
        pass

test_getshopsid()
