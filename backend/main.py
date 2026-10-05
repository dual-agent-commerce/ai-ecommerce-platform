from fastapi import FastAPI, HTTPException

app = FastAPI()

products = [
    {
        "id": 1,
        "name": "RTX 5070",
        "cost": 18000,
        "current_price": 22000,
        "inventory": 10
    },
    {
        "id": 2,
        "name": "RTX 5060",
        "cost": 12000,
        "current_price": 15000,
        "inventory": 20
    }
]


@app.get("/")
def root():
    return {"message": "AI E-commerce API is running"}


@app.get("/products")
def get_products():
    return products


@app.get("/products/{product_id}")
def get_product(product_id: int):

    for product in products:

        if product["id"] == product_id:
            return product

    raise HTTPException(
        status_code=404,
        detail="Product not found"
    )

@app.get("/products/price/{product_id}")
def get_product(product_id: int):

    for product in products:

        if product["id"] == product_id:
            return product["current_price"]

    raise HTTPException(
        status_code=404,
        detail="Product not found"
    )