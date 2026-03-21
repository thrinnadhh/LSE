import requests

BASE_URL = "http://127.0.0.1:3000"
OTP_BYPASS_CODE = "123456"
OWNER_PHONE = "+15550001111"
TIMEOUT = 30

def get_owner_jwt():
    # Send OTP
    r1 = requests.post(
        f"{BASE_URL}/auth/send-otp",
        json={"phone": OWNER_PHONE},
        timeout=TIMEOUT,
    )
    assert r1.status_code == 200
    # Verify OTP with bypass code
    r2 = requests.post(
        f"{BASE_URL}/auth/verify-otp",
        json={"phone": OWNER_PHONE, "otp": OTP_BYPASS_CODE},
        timeout=TIMEOUT,
    )
    assert r2.status_code == 200
    data = r2.json()
    assert "accessToken" in data and data["accessToken"]
    return data["accessToken"]

def create_shop(owner_jwt):
    headers = {"Authorization": f"Bearer {owner_jwt}"}
    shop_payload = {
        "name": "Test Shop for Product TC006",
        "location": {"lat": 12.9716, "lon": 77.5946},
        "category": "groceries"
    }
    r = requests.post(
        f"{BASE_URL}/shops",
        json=shop_payload,
        headers=headers,
        timeout=TIMEOUT,
    )
    assert r.status_code == 201
    data = r.json()
    assert "shopId" in data and data["shopId"]
    return data["shopId"]

def delete_product(owner_jwt, product_id):
    # No explicit delete endpoint for products mentioned in PRD, so we skip delete.
    # Assuming no delete endpoint exists.
    pass

def delete_shop(owner_jwt, shop_id):
    # No explicit delete endpoint for shops mentioned in PRD, so we skip delete.
    # Assuming no delete endpoint exists.
    pass

def test_post_products_with_valid_and_missing_fields():
    owner_jwt = get_owner_jwt()
    headers = {"Authorization": f"Bearer {owner_jwt}"}

    shop_id = None
    product_id = None

    # Create a shop to get a valid shop_id
    shop_id = create_shop(owner_jwt)

    # Prepare valid product data
    valid_product = {
        "shop_id": shop_id,
        "name": "Test Product TC006",
        "price": 19.99,
        "stock": 50,
        "category": "snacks"
    }

    try:
        # POST /products with valid data
        r_valid = requests.post(
            f"{BASE_URL}/products",
            json=valid_product,
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r_valid.status_code == 201
        data_valid = r_valid.json()
        assert "productId" in data_valid and data_valid["productId"]
        product_id = data_valid["productId"]

        # POST /products with missing required fields (missing "price")
        invalid_product = {
            "shop_id": shop_id,
            "name": "Invalid Product TC006",
            # "price" field intentionally omitted
            "stock": 10,
            "category": "snacks"
        }
        r_invalid = requests.post(
            f"{BASE_URL}/products",
            json=invalid_product,
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r_invalid.status_code == 400

    finally:
        # Cleanup if possible; no delete product/shop endpoints specified in PRD so skipping
        pass

test_post_products_with_valid_and_missing_fields()