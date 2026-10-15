def recommend_price(product):
    return {
        "product_id": product["id"],
        "suggested_price": product["current_price"] + 500,
        "method": "mock_hybrid",
        "confidence": 0.85
    }