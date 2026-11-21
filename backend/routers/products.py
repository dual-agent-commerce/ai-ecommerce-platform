"""Product management and sales-history lookup."""
import json
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from backend.database import engine
from backend.schemas import ProductCreate, ProductPriceUpdate

router = APIRouter(tags=["Products"])

@router.get("/products")
def get_products():
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT * FROM products ORDER BY id")
        )
        return [dict(row) for row in result.mappings()]


@router.get("/products/{product_id}")
def get_product(product_id: int):
    with engine.connect() as connection:
        result = connection.execute(
            text("""
                SELECT *
                FROM products
                WHERE id = :id
            """),
            {"id": product_id}
        )
        product = result.mappings().first()

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    return dict(product)


@router.post("/products")
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
                "specifications": json.dumps(
                    product.specifications
                )
            }
        )

        new_product = dict(result.mappings().one())

    return new_product


@router.patch("/products/{product_id}/price")
def update_product_price(
    product_id: int,
    product: ProductPriceUpdate
):
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


@router.delete("/products/{product_id}")
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


@router.get("/products/{product_id}/sales-history")
def get_sales_history(product_id: int):

    with engine.connect() as connection:
        result = connection.execute(
            text("""
                SELECT
                    product_id,
                    period,
                    price,
                    units_sold
                FROM sales_history
                WHERE product_id = :product_id
                ORDER BY period ASC
            """),
            {"product_id": product_id}
        )

        history = result.mappings().all()

    return [dict(row) for row in history]

