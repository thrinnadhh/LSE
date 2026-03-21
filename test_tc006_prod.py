import requests
BASE_URL = "http://localhost:3000"
OTP_BYPASS_CODE = "123456"
OWNER_PHONE = "+15550001111"

r1 = requests.post(f"{BASE_URL}/auth/send-otp", json={"phone": OWNER_PHONE})
r2 = requests.post(f"{BASE_URL}/auth/verify-otp", json={"phone": OWNER_PHONE, "otp": OTP_BYPASS_CODE})
token = r2.json()["accessToken"]

shop_payload = {
    "name": "Test Shop for Product TC006",
    "location": {"lat": 12.9716, "lon": 77.5946},
    "category": "groceries"
}
headers = {"Authorization": f"Bearer {token}"}
r3 = requests.post(f"{BASE_URL}/shops", json=shop_payload, headers=headers)
shop_id = r3.json()["shopId"]

valid_product = {
    "shop_id": shop_id,
    "name": "Test Product TC006",
    "price": 19.99,
    "stock": 50,
    "category": "snacks"
}
r4 = requests.post(f"{BASE_URL}/products", json=valid_product, headers=headers)
print("CREATE PRODUCT RESPONSE:", r4.status_code, r4.text)
