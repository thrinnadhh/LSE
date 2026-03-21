import requests
BASE_URL = "http://localhost:3000"
OTP_BYPASS_CODE = "123456"
OWNER_PHONE = "+15550001111"

r1 = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": OWNER_PHONE})
r2 = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": OWNER_PHONE, "otp": OTP_BYPASS_CODE})
token = r2.json()["accessToken"]

print("TOKEN:", token)

shop_payload = {
    "name": "Test Shop for Product TC006",
    "location": {"lat": 12.9716, "lon": 77.5946},
    "category": "groceries"
}
headers = {"Authorization": f"Bearer {token}"}
r3 = requests.post(f"{BASE_URL}/shops", json=shop_payload, headers=headers)
print("CREATE SHOP RESPONSE:", r3.status_code, r3.text)
