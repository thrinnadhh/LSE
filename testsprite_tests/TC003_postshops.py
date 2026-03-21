import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30
OWNER_PHONE = "+1234567890"  # Example phone number for shop owner
OTP = "123456"

def test_postshops():
    headers = {"Content-Type": "application/json"}
    shop_id = None
    access_token = None

    try:
        # Step 1: Authenticate as shop owner to get JWT access token
        send_otp_resp = requests.post(
            f"{BASE_URL}/auth/send-otp",
            json={"phone": OWNER_PHONE},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert send_otp_resp.status_code == 200

        verify_otp_resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": OWNER_PHONE, "otp": OTP},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert verify_otp_resp.status_code == 200
        verify_otp_json = verify_otp_resp.json()
        assert "accessToken" in verify_otp_json and isinstance(verify_otp_json["accessToken"], str)
        access_token = verify_otp_json["accessToken"]

        # Step 2: Create a new shop using the access token
        shop_data = {
            "name": "Test Shop",
            "location": "123 Test Street, Test City",
            "category": "Grocery"
        }
        auth_headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        create_shop_resp = requests.post(
            f"{BASE_URL}/shops",
            json=shop_data,
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert create_shop_resp.status_code == 201
        resp_json = create_shop_resp.json()
        assert "shopId" in resp_json and isinstance(resp_json["shopId"], (str, int))
        shop_id = resp_json["shopId"]
    finally:
        # Cleanup: delete the created shop if shop_id is set
        if shop_id:
            try:
                # Assuming DELETE /shops/:id is available for cleanup (not in PRD, but we try)
                requests.delete(
                    f"{BASE_URL}/shops/{shop_id}",
                    headers={"Authorization": f"Bearer {access_token}"} if access_token else {},
                    timeout=TIMEOUT,
                )
            except Exception:
                pass

test_postshops()