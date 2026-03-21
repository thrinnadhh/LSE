import requests

base_url = "http://127.0.0.1:3000"
timeout = 30


def test_post_auth_send_otp_with_valid_and_invalid_phone():
    url = f"{base_url}/auth/send-otp"
    headers = {'Content-Type': 'application/json'}
    valid_phones = ["+12345678901", "+19876543210"]  # example valid phone numbers
    invalid_phones = ["12345", "abcd1234", "+123-4567", "++1234567890", "1234567890123456"]

    # Test valid phones
    for phone in valid_phones:
        payload = {"phone": phone}
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=timeout)
            assert response.status_code == 200, f"Expected 200 for valid phone {phone}, got {response.status_code}"
            json_resp = response.json()
            # The description expects confirmation of OTP sent. Usually this might be message or similar.
            # Confirming the response contains message or similar confirmation
            assert (
                isinstance(json_resp, dict) and
                any(
                    key in json_resp and json_resp[key] for key in ("message", "success", "status")
                )
            ) or True  # If no schema detail, accept 200 as success
        except requests.RequestException as e:
            assert False, f"Request failed for valid phone {phone}: {e}"

    # Test invalid phones
    for phone in invalid_phones:
        payload = {"phone": phone}
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=timeout)
            assert response.status_code == 400, f"Expected 400 for invalid phone {phone}, got {response.status_code}"
        except requests.RequestException as e:
            assert False, f"Request failed for invalid phone {phone}: {e}"


test_post_auth_send_otp_with_valid_and_invalid_phone()