import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30
OWNER_PHONE = "+15550001111"
OTP_BYPASS = "123456"

def test_postproducts():
    headers = {"Content-Type": "application/json"}

    # Step 1: Authenticate shop owner to get JWT
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/send-otp",
            json={"phone": OWNER_PHONE},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200

        resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": OWNER_PHONE, "otp": OTP_BYPASS},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        owner_jwt = resp.json().get("accessToken")
        assert owner_jwt and isinstance(owner_jwt, str)
        auth_headers = {
            "Authorization": f"Bearer {owner_jwt}",
            "Content-Type": "application/json",
        }

        # Step 2: Create a new shop to get shop_id
        shop_payload = {
            "name": "Test Shop for Product",
            "location": "123 Test St, Test City",
            "category": "TestCategory"
        }
        resp = requests.post(
            f"{BASE_URL}/shops", json=shop_payload, headers=auth_headers, timeout=TIMEOUT
        )
        assert resp.status_code == 201
        shop_id = resp.json().get("shopId")
        assert shop_id and isinstance(shop_id, str)

        # Step 3: Add a new product tied to the created shop
        product_payload = {
            "shop_id": shop_id,
            "name": "Test Product",
            "price": 19.99,
            "stock": 50,
            "category": "TestProductCategory"
        }
        resp = requests.post(
            f"{BASE_URL}/products", json=product_payload, headers=auth_headers, timeout=TIMEOUT
        )
        assert resp.status_code == 201
        product_id = resp.json().get("productId")
        assert product_id and isinstance(product_id, str)

    finally:
        # Cleanup: delete created product and shop if possible
        if 'product_id' in locals():
            try:
                requests.delete(f"{BASE_URL}/products/{product_id}", headers=auth_headers, timeout=TIMEOUT)
            except Exception:
                pass
        if 'shop_id' in locals():
            try:
                requests.delete(f"{BASE_URL}/shops/{shop_id}", headers=auth_headers, timeout=TIMEOUT)
            except Exception:
                pass

test_postproducts()
