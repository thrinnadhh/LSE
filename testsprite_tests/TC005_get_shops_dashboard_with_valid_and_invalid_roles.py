import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS_CODE = "123456"
TIMEOUT = 30

def get_jwt_for_role(phone: str) -> str:
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/send-otp",
            json={"phone": phone},
            timeout=TIMEOUT
        )
        resp.raise_for_status()
        verify_resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json={"phone": phone, "otp": OTP_BYPASS_CODE},
            timeout=TIMEOUT
        )
        verify_resp.raise_for_status()
        data = verify_resp.json()
        return data.get("accessToken")
    except requests.RequestException as e:
        raise RuntimeError(f"Failed to get JWT for phone {phone}: {e}")

def test_get_shops_dashboard_with_valid_and_invalid_roles():
    # Define phones for roles:
    shop_owner_phone = "+10000000001"  # assumed owner phone
    non_owner_phone = "+20000000002"   # assumed non-owner role phone

    # Obtain JWT tokens
    owner_jwt = get_jwt_for_role(shop_owner_phone)
    non_owner_jwt = get_jwt_for_role(non_owner_phone)

    # Using try-finally for no resource creation needed here

    # Test GET /shops/dashboard with valid shop owner JWT
    headers_owner = {"Authorization": f"Bearer {owner_jwt}"}
    try:
        owner_resp = requests.get(f"{BASE_URL}/shops/dashboard", headers=headers_owner, timeout=TIMEOUT)
        owner_resp.raise_for_status()
        # Validate response status code 200
        assert owner_resp.status_code == 200, f"Expected 200, got {owner_resp.status_code}"
        owner_data = owner_resp.json()
        # Basic validation: owner_data should be a dict and not empty (as dashboard metrics)
        assert isinstance(owner_data, dict), "Dashboard response is not a JSON object"
        assert len(owner_data) > 0, "Dashboard response is empty"
    except requests.HTTPError as e:
        raise AssertionError(f"GET /shops/dashboard with shop owner JWT failed: {e}")

    # Test GET /shops/dashboard with JWT of non-owner role expecting 403 Forbidden
    headers_non_owner = {"Authorization": f"Bearer {non_owner_jwt}"}
    non_owner_resp = requests.get(f"{BASE_URL}/shops/dashboard", headers=headers_non_owner, timeout=TIMEOUT)
    assert non_owner_resp.status_code == 403, f"Expected 403 forbidden, got {non_owner_resp.status_code}"

test_get_shops_dashboard_with_valid_and_invalid_roles()