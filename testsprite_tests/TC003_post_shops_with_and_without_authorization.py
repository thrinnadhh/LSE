import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS_CODE = "123456"
TIMEOUT = 30

def test_post_shops_with_and_without_authorization():
    owner_phone = "+15555550123"
    headers_json = {"Content-Type": "application/json"}

    # Step 1: Obtain JWT for shop owner using OTP bypass flow
    try:
        # Send OTP
        resp_send_otp = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": owner_phone}, timeout=TIMEOUT, headers=headers_json)
        assert resp_send_otp.status_code == 200, f"Failed to send OTP, status: {resp_send_otp.status_code}"

        # Verify OTP (bypass code)
        resp_verify_otp = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": owner_phone, "otp": OTP_BYPASS_CODE}, timeout=TIMEOUT, headers=headers_json)
        assert resp_verify_otp.status_code == 200, f"Failed to verify OTP, status: {resp_verify_otp.status_code}"
        owner_jwt = resp_verify_otp.json().get("accessToken")
        assert owner_jwt and isinstance(owner_jwt, str), "No accessToken received after OTP verification"

        auth_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {owner_jwt}"
        }

        shop_payload = {
            "name": "Test Shop Authorization",
            "location": "123 Test St, Test City",
            "category": "grocery"
        }

        # Step 2: POST /shops with valid authorization header
        resp_post_shop_auth = requests.post(f"{BASE_URL}/shops", json=shop_payload, headers=auth_headers, timeout=TIMEOUT)
        assert resp_post_shop_auth.status_code == 201, f"Expected 201 Created, got {resp_post_shop_auth.status_code}"
        shop_id = resp_post_shop_auth.json().get("shopId")
        assert shop_id and isinstance(shop_id, str), "No shopId returned after shop creation"

        # Step 3: POST /shops without Authorization header
        resp_post_shop_no_auth = requests.post(f"{BASE_URL}/shops", json=shop_payload, headers={"Content-Type": "application/json"}, timeout=TIMEOUT)
        assert resp_post_shop_no_auth.status_code == 401, f"Expected 401 Unauthorized without auth, got {resp_post_shop_no_auth.status_code}"

    finally:
        # Cleanup: Delete the created shop if shop_id is available
        if 'shop_id' in locals():
            try:
                del_headers = auth_headers if 'auth_headers' in locals() else {}
                requests.delete(f"{BASE_URL}/shops/{shop_id}", headers=del_headers, timeout=TIMEOUT)
            except Exception:
                pass

test_post_shops_with_and_without_authorization()