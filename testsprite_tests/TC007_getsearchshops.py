import requests

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30

def test_getsearchshops():
    params = {
        "q": "bakery",
        "lat": 12.9716,
        "lon": 77.5946
    }
    try:
        response = requests.get(f"{BASE_URL}/search/shops", params=params, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected status 200, got {response.status_code}"
        shops = response.json()
        assert isinstance(shops, list), "Response is not a list"
        # Validate each shop has required fields and correct types
        for shop in shops:
            assert "shopId" in shop, "shopId missing in shop item"
            assert "name" in shop, "name missing in shop item"
            assert "deliveryTag" in shop, "deliveryTag missing in shop item"
            assert isinstance(shop["shopId"], (str, int)), "shopId is not string or int"
            assert isinstance(shop["name"], str), "name is not string"
            assert isinstance(shop["deliveryTag"], (str, type(None))), "deliveryTag is not string or None"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_getsearchshops()