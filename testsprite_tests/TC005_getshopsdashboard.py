import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS = "123456"
TIMEOUT = 30

def test_getshopsdashboard():
    owner_phone = "+15555550123"
    headers = {"Content-Type": "application/json"}

    # Step 1: Authenticate as shop owner and get JWT token
    resp_send_otp = requests.post(
        f"{BASE_URL}/auth/send-otp",
        json={"phone": owner_phone},
        timeout=TIMEOUT,
        headers=headers,
    )
    assert resp_send_otp.status_code == 200

    resp_verify_otp = requests.post(
        f"{BASE_URL}/auth/verify-otp",
        json={"phone": owner_phone, "otp": OTP_BYPASS},
        timeout=TIMEOUT,
        headers=headers,
    )
    assert resp_verify_otp.status_code == 200
    data = resp_verify_otp.json()
    access_token = data.get("accessToken")
    assert isinstance(access_token, str) and access_token != ""

    auth_headers = {"Authorization": f"Bearer {access_token}"}

    # Step 2: Create a new shop to ensure dashboard has data
    shop_payload = {
        "name": "Test Shop for Dashboard",
        "location": "Test Location",
        "category": "Test Category"
    }
    resp_create_shop = requests.post(
        f"{BASE_URL}/shops",
        json=shop_payload,
        headers={**auth_headers, **headers},
        timeout=TIMEOUT,
    )
    assert resp_create_shop.status_code == 201
    shop_id = resp_create_shop.json().get("shopId")
    assert isinstance(shop_id, str) and shop_id != ""

    # Step 3: Request the shop owner dashboard metrics
    resp_dashboard = requests.get(
        f"{BASE_URL}/shops/dashboard",
        headers=auth_headers,
        timeout=TIMEOUT,
    )
    assert resp_dashboard.status_code == 200
    dashboard_data = resp_dashboard.json()
    # Validate dashboard_data is a dict
    assert isinstance(dashboard_data, dict)
    # Check for expected keys in the dashboard data
    expected_keys = ["totalShops", "totalOrders", "totalRevenue"]
    for key in expected_keys:
        assert key in dashboard_data

test_getshopsdashboard()
