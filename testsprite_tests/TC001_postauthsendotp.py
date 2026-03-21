import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30

def test_postauthsendotp():
    url = f"{BASE_URL}/auth/send-otp"
    payload = {
        "phone": "+1234567890"
    }
    headers = {
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
        assert response.status_code == 200, f"Expected status 200, got {response.status_code}"
        body = response.json()
        # Confirm OTP sent confirmation phrase in response body (assuming 'OTP sent' text is present)
        assert isinstance(body, dict), "Response JSON is not a dictionary"
        otp_confirmation_found = any("otp" in k.lower() or "sent" in str(v).lower() for k,v in body.items())
        assert otp_confirmation_found, f"Response does not confirm OTP sent: {body}"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_postauthsendotp()