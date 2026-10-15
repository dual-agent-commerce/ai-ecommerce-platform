def publish_product(listing_data):
    return {
        "status": "success",
        "listing_id": f"MOCK-{listing_data['product_id']}",
        "error_message": ""
    }