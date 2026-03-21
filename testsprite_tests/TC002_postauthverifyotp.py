import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30

def test_post_auth_verify_otp():
    url = f"{BASE_URL}/auth/verify-otp"
    payload = {
        "phone": "+1234567890",
        "otp": "123456"
    }
    headers = {
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 200, f"Expected status 200, got {response.status_code}"
    try:
        json_resp = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    assert "accessToken" in json_resp, "accessToken missing in response"
    access_token = json_resp["accessToken"]
    assert isinstance(access_token, str) and len(access_token) > 0, "accessToken is empty or not a string"


test_post_auth_verify_otp()