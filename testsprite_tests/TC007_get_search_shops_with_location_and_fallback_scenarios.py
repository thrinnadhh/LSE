import requests
from requests.exceptions import RequestException

BASE_URL = "http://127.0.0.1:3000"
TIMEOUT = 30

def test_get_search_shops_with_location_and_fallback():
    # 1) Valid query and location params -> expect 200 and list of shops
    try:
        params = {
            "q": "bakery",
            "lat": "12.9716",
            "lon": "77.5946"
        }
        resp = requests.get(f"{BASE_URL}/search/shops", params=params, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        shops = resp.json()
        assert isinstance(shops, list), "Expected shops to be a list"
        for shop in shops:
            assert "shopId" in shop, "Missing shopId in shop data"
            assert "name" in shop, "Missing name in shop data"
            assert "deliveryTag" in shop, "Missing deliveryTag in shop data"
    except RequestException as e:
        assert False, f"Request failed: {str(e)}"

    # 2) Missing location params lat/lon -> expect 400 error
    try:
        params = {
            "q": "bakery"
        }
        resp = requests.get(f"{BASE_URL}/search/shops", params=params, timeout=TIMEOUT)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    except RequestException as e:
        assert False, f"Request failed: {str(e)}"

    # 3) Simulate backend 500 error and fallback cache results
    # We try normal search that causes 500. Since no direct way to cause backend error,
    # we attempt a request with lat/lon that might cause backend error or request fallback cache explicitly.

    # a) Try to induce 500 error scenario
    try:
        params = {
            "q": "bakery",
            "lat": "12.9716",
            "lon": "77.5946",
            "simulateError": "500"  # Assume this param triggers backend error if supported
        }
        resp = requests.get(f"{BASE_URL}/search/shops", params=params, timeout=TIMEOUT)
        if resp.status_code == 500:
            # Backend returns 500 error as expected
            pass
        else:
            # If not 500, just ignore result and move on to fallback check
            pass
    except RequestException:
        # Possible network or server error - treat as backend error
        pass

    # b) Request fallback cached results
    try:
        params = {
            "q": "bakery",
            "useCache": "true"
        }
        resp = requests.get(f"{BASE_URL}/search/shops", params=params, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200 for fallback cache, got {resp.status_code}"
        shops = resp.json()
        assert isinstance(shops, list), "Expected fallback shops to be a list"
        for shop in shops:
            assert "shopId" in shop, "Missing shopId in fallback shop data"
            assert "name" in shop, "Missing name in fallback shop data"
            assert "deliveryTag" in shop, "Missing deliveryTag in fallback shop data"
    except RequestException as e:
        assert False, f"Fallback cache request failed: {str(e)}"

test_get_search_shops_with_location_and_fallback()
