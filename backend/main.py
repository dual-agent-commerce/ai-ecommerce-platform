
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from backend.database import engine

app = FastAPI()


# 新增商品時，前端需要提供的資料
class ProductCreate(BaseModel):
    name: str
    cost: int
    current_price: int
    inventory: int

# 修改價格時，前端需要提供的資料
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
                INSERT INTO products (name, cost, current_price, inventory)
                VALUES (:name, :cost, :current_price, :inventory)
                RETURNING id, name, cost, current_price, inventory
            """),
            {
                "name": product.name,
                "cost": product.cost,
                "current_price": product.current_price,
                "inventory": product.inventory
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
