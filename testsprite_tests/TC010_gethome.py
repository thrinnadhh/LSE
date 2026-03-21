import requests

BASE_URL = "http://127.0.0.1:3000"
OTP = "123456"
TEST_PHONE = "+19999999999"


def test_gethome():
    """
    Test retrieving personalized home feed with valid JWT authorization,
    expect 200 status and feed containing favorites, regularShops, recommended,
    and categories.
    """
    headers = {"Content-Type": "application/json"}
    # Step 1: Verify OTP to get JWT
    verify_otp_payload = {"phone": TEST_PHONE, "otp": OTP}
    try:
        verify_resp = requests.post(
            f"{BASE_URL}/auth/verify-otp",
            json=verify_otp_payload,
            headers=headers,
            timeout=30,
        )
        assert verify_resp.status_code == 200, f"OTP verify failed: {verify_resp.text}"
        data = verify_resp.json()
        access_token = data.get("accessToken")
        assert access_token and isinstance(access_token, str), "Missing accessToken"

        # Step 2: Use JWT to call /home endpoint
        auth_headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        home_resp = requests.get(f"{BASE_URL}/home", headers=auth_headers, timeout=30)
        assert home_resp.status_code == 200, f"Home request failed: {home_resp.text}"

        home_data = home_resp.json()
        # Validate expected keys in response
        expected_keys = ["favorites", "regularShops", "recommended", "categories"]
        for key in expected_keys:
            assert key in home_data, f"Key '{key}' missing in home feed response"
            assert isinstance(home_data[key], list), f"Key '{key}' is not a list"

    except (requests.RequestException, AssertionError) as e:
        raise AssertionError(f"Test failed: {e}")


test_gethome()