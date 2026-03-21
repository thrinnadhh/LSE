import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30
OTP_BYPASS_CODE = "123456"

def test_post_auth_verify_otp_with_correct_and_incorrect_otp():
    phone = "+12345678901"  # example phone number
    
    # Step 1: Send OTP - to simulate sending OTP
    send_otp_resp = requests.post(
        f"{BASE_URL}/auth/send-otp",
        json={"phone": phone},
        timeout=TIMEOUT
    )
    assert send_otp_resp.status_code == 200, f"Failed to send OTP: {send_otp_resp.text}"
    
    # Step 2: Verify OTP with correct otp (using bypass code)
    verify_correct_resp = requests.post(
        f"{BASE_URL}/auth/verify-otp",
        json={"phone": phone, "otp": OTP_BYPASS_CODE},
        timeout=TIMEOUT
    )
    assert verify_correct_resp.status_code == 200, f"Correct OTP verification failed: {verify_correct_resp.text}"
    json_data = verify_correct_resp.json()
    assert "accessToken" in json_data and isinstance(json_data["accessToken"], str) and len(json_data["accessToken"]) > 0, \
        "accessToken missing or invalid in successful verify-otp response"
    
    # Step 3: Verify OTP with incorrect otp
    incorrect_otp = "000000"
    verify_incorrect_resp = requests.post(
        f"{BASE_URL}/auth/verify-otp",
        json={"phone": phone, "otp": incorrect_otp},
        timeout=TIMEOUT
    )
    assert verify_incorrect_resp.status_code == 401, f"Incorrect OTP verification did not fail as expected: {verify_incorrect_resp.text}"

test_post_auth_verify_otp_with_correct_and_incorrect_otp()