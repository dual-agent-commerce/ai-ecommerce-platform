
from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from backend.database import engine
from fastapi.middleware.cors import CORSMiddleware
from backend.agents.mock_agent1 import recommend_price
from backend.agents.mock_agent2 import publish_product
from typing import Any
from pydantic import BaseModel, Field
import json


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# insert new product format
class ProductCreate(BaseModel):
    name: str
    cost: int = Field(ge=0)
    current_price: int = Field(ge=0)
    inventory: int = Field(ge=0)
    category: str | None = None
    brand: str | None = None
    specifications: dict[str, Any] = Field(default_factory=dict)

# Price upsating format
class ProductPriceUpdate(BaseModel):
    current_price: int


@app.get("/")
def root():
    return {"message": "AI E-commerce API is running"}


# get all product
@app.get("/products")
def get_products():
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT * FROM products ORDER BY id")
        )

        products = [dict(row) for row in result.mappings()]

    return products


# get products by id
@app.get("/products/{product_id}")
def get_product(product_id: int):
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT * FROM products WHERE id = :id"),
            {"id": product_id}
        )

        product = result.mappings().first()

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    return dict(product)


# get products price by id
@app.get("/products/price/{product_id}")
def get_product_price(product_id: int):
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT current_price FROM products WHERE id = :id"),
            {"id": product_id}
        )

        price = result.scalar_one_or_none()

    if price is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    return {"current_price": price}


# insert new product
@app.post("/products")
def create_product(product: ProductCreate):
    with engine.begin() as connection:
        result = connection.execute(
            text("""
                INSERT INTO products (
                    name,
                    cost,
                    current_price,
                    inventory,
                    category,
                    brand,
                    specifications
                )
                VALUES (
                    :name,
                    :cost,
                    :current_price,
                    :inventory,
                    :category,
                    :brand,
                    CAST(:specifications AS JSONB)
                )
                RETURNING *
            """),
            {
                "name": product.name,
                "cost": product.cost,
                "current_price": product.current_price,
                "inventory": product.inventory,
                "category": product.category,
                "brand": product.brand,
                "specifications": json.dumps(product.specifications)
            }
        )

        new_product = dict(result.mappings().one())

    return new_product


# modify specific products price by id
@app.patch("/products/{product_id}/price")
def update_product_price(product_id: int, product: ProductPriceUpdate):
    with engine.begin() as connection:
        result = connection.execute(
            text("""
                UPDATE products
                SET current_price = :price
                WHERE id = :id
                RETURNING id, name, current_price
            """),
            {
                "price": product.current_price,
                "id": product_id
            }
        )

        updated_product = result.mappings().first()

    if updated_product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    return dict(updated_product)


# delete product by id
@app.delete("/products/{product_id}")
def delete_product(product_id: int):
    with engine.begin() as connection:
        result = connection.execute(
            text("""
                DELETE FROM products
                WHERE id = :id
                RETURNING id, name
            """),
            {"id": product_id}
        )

        deleted_product = result.mappings().first()

    if deleted_product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    return {
        "message": "Product deleted successfully",
        "deleted_product": dict(deleted_product)
    }


@app.post("/workflow/{product_id}")
def run_workflow(product_id: int):

    # 1. get item from backend
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT * FROM products WHERE id = :id"),
            {"id": product_id}
        )
        product = result.mappings().first()

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    product = dict(product)

    # 2. final pricing result from Agent 1
    pricing_result = recommend_price(product)

    # 3. modify info format for Agent 2
    listing_data = {
        "product_id": product["id"],
        "product_name": product["name"],
        "price": pricing_result["suggested_price"],
        "stock": product["inventory"],
        "image_urls": [],
        "target_platform": "mock_platform",
        "platform_specific_data": {},
        "variants": []
    }

    # 4. Agent 2 fake publish
    listing_result = publish_product(listing_data)

    # 5. Backend return
    return {
        "product_id": product_id,
        "pricing_result": pricing_result,
        "listing_result": listing_result
    }


# search sales history
@app.get("/products/{product_id}/sales-history")
def get_sales_history(product_id: int):

    with engine.connect() as connection:
        result = connection.execute(
            text("""
                SELECT product_id, period, price, units_sold
                FROM sales_history
                WHERE product_id = :product_id
                ORDER BY period ASC
            """),
            {"product_id": product_id}
        )

        history = result.mappings().all()

    return [dict(row) for row in history]