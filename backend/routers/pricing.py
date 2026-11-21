"""Mock price recommendations and human-review flow."""
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from backend.database import engine
from backend.schemas import (
    ReviewApprove, ReviewReject, PendingReviewResponse, WorkflowRunResponse,
    ReviewApproveResponse, ReviewRejectResponse,
)
from backend.agents.mock_agent1 import recommend_price

router = APIRouter(tags=["Pricing & Reviews"])

@router.get("/workflow/pending", response_model=list[PendingReviewResponse])
def get_pending_reviews():

    with engine.connect() as connection:
        result = connection.execute(
            text("""
                SELECT
                    r.id AS review_id,
                    r.product_id,
                    p.name AS product_name,
                    r.original_price,
                    r.suggested_price,
                    r.status,
                    r.created_at
                FROM pricing_reviews r
                JOIN products p
                    ON r.product_id = p.id
                WHERE r.status = 'pending'
                ORDER BY r.created_at DESC, r.id DESC
            """)
        )

        reviews = [
            dict(row)
            for row in result.mappings()
        ]

    return reviews


@router.post("/workflow/{product_id}", response_model=WorkflowRunResponse)
def run_workflow(product_id: int):

    # 1. 取得商品
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

    product = dict(product)

    # 2. Agent 1 計算價格
    pricing_result = recommend_price(product)

    suggested_price = pricing_result.get(
        "suggested_price"
    )

    if (
        isinstance(suggested_price, bool)
        or not isinstance(suggested_price, int)
        or suggested_price < 0
    ):
        raise HTTPException(
            status_code=502,
            detail="Agent 1 returned an invalid price"
        )

    # 3. 寫入待審核紀錄
    with engine.begin() as connection:
        result = connection.execute(
            text("""
                INSERT INTO pricing_reviews (
                    product_id,
                    original_price,
                    suggested_price,
                    status
                )
                VALUES (
                    :product_id,
                    :original_price,
                    :suggested_price,
                    'pending'
                )
                RETURNING
                    id,
                    status,
                    created_at
            """),
            {
                "product_id": product_id,
                "original_price": product["current_price"],
                "suggested_price": suggested_price
            }
        )

        review = dict(result.mappings().one())

    return {
        "review_id": review["id"],
        "product_id": product_id,
        "product_name": product["name"],
        "original_price": product["current_price"],
        "pricing_result": pricing_result,
        "status": review["status"],
        "created_at": review["created_at"],
        "message": "Waiting for human approval"
    }


@router.post("/workflow/reviews/{review_id}/approve", response_model=ReviewApproveResponse)
def approve_review(
    review_id: int,
    request: ReviewApprove
):
    with engine.begin() as connection:

        # 1. 鎖定審核紀錄
        result = connection.execute(
            text("""
                SELECT *
                FROM pricing_reviews
                WHERE id = :id
                FOR UPDATE
            """),
            {"id": review_id}
        )

        review = result.mappings().first()

        if review is None:
            raise HTTPException(
                status_code=404,
                detail="Review not found"
            )

        if review["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail="Review has already been processed"
            )

        # 2. 鎖定商品
        result = connection.execute(
            text("""
                SELECT *
                FROM products
                WHERE id = :id
                FOR UPDATE
            """),
            {"id": review["product_id"]}
        )

        product = result.mappings().first()

        if product is None:
            raise HTTPException(
                status_code=404,
                detail="Product not found"
            )

        # 3. 檢查商品價格是否已改變
        if product["current_price"] != review["original_price"]:
            raise HTTPException(
                status_code=409,
                detail="Product price has changed since review creation"
            )

        # 4. 決定最終價格
        final_price = (
            review["suggested_price"]
            if request.approved_price is None
            else request.approved_price
        )

        # 5. 更新商品正式價格
        connection.execute(
            text("""
                UPDATE products
                SET current_price = :price
                WHERE id = :id
            """),
            {
                "price": final_price,
                "id": review["product_id"]
            }
        )

        # 6. 更新人工審核狀態
        connection.execute(
            text("""
                UPDATE pricing_reviews
                SET
                    status = 'approved',
                    approved_price = :price,
                    reviewed_at = NOW()
                WHERE id = :id
            """),
            {
                "price": final_price,
                "id": review_id
            }
        )

        # 7. 自動建立 Agent 2 上架工作
        result = connection.execute(
            text("""
                INSERT INTO listing_jobs (
                    review_id,
                    product_id,
                    approved_price,
                    target_platform,
                    status
                )
                VALUES (
                    :review_id,
                    :product_id,
                    :approved_price,
                    'mock_platform',
                    'pending'
                )
                RETURNING id
            """),
            {
                "review_id": review_id,
                "product_id": review["product_id"],
                "approved_price": final_price
            }
        )

        job_id = result.scalar_one()

    return {
        "review_id": review_id,
        "product_id": review["product_id"],
        "approved_price": final_price,
        "status": "approved",
        "listing_job": {
            "job_id": job_id,
            "status": "pending"
        },
        "message": "Pricing approved and listing job created"
    }


@router.post("/workflow/reviews/{review_id}/reject", response_model=ReviewRejectResponse)
def reject_review(
    review_id: int,
    request: ReviewReject
):

    with engine.begin() as connection:

        # 1. 鎖定審核紀錄
        result = connection.execute(
            text("""
                SELECT *
                FROM pricing_reviews
                WHERE id = :id
                FOR UPDATE
            """),
            {"id": review_id}
        )

        review = result.mappings().first()

        if review is None:
            raise HTTPException(
                status_code=404,
                detail="Review not found"
            )

        # 2. 防止重複審核
        if review["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail="Review has already been processed"
            )

        # 3. 記錄拒絕原因
        connection.execute(
            text("""
                UPDATE pricing_reviews
                SET
                    status = 'rejected',
                    rejection_reason = :reason,
                    reviewed_at = NOW()
                WHERE id = :id
            """),
            {
                "reason": request.reason,
                "id": review_id
            }
        )

    return {
        "review_id": review_id,
        "product_id": review["product_id"],
        "status": "rejected",
        "rejection_reason": request.reason,
        "message": "Pricing review rejected"
    }

