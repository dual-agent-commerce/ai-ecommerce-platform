"""Listing-job execution; still calls mock Agent 2 for now."""
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from backend.database import engine
from backend.schemas import ListingJobResponse, ListingExecuteResponse, ListingRetryResponse
from backend.agents.mock_agent2 import publish_product

router = APIRouter(tags=["Listing Jobs"])

@router.post("/listing-jobs/{job_id}/execute", response_model=ListingExecuteResponse)
def execute_listing_job(job_id: int):

    # 1. 原子性領取工作
    with engine.begin() as connection:
        result = connection.execute(
            text("""
                UPDATE listing_jobs
                SET
                    status = 'processing',
                    attempts = attempts + 1,
                    started_at = NOW(),
                    completed_at = NULL,
                    error_message = NULL
                WHERE id = :id
                  AND status = 'pending'
                RETURNING *
            """),
            {"id": job_id}
        )

        job = result.mappings().first()

        if job is None:
            exists = connection.execute(
                text("""
                    SELECT status
                    FROM listing_jobs
                    WHERE id = :id
                """),
                {"id": job_id}
            ).scalar_one_or_none()

            if exists is None:
                raise HTTPException(
                    status_code=404,
                    detail="Listing job not found"
                )

            raise HTTPException(
                status_code=409,
                detail=f"Job cannot execute in status: {exists}"
            )

        job = dict(job)

    # 2. 取得商品資料
    try:
        with engine.connect() as connection:
            result = connection.execute(
                text("""
                    SELECT *
                    FROM products
                    WHERE id = :id
                """),
                {"id": job["product_id"]}
            )

            product = result.mappings().first()

        if product is None:
            raise ValueError("Product not found")

        product = dict(product)

        # 3. 準備 Agent 2 資料
        listing_data = {
            "product_id": product["id"],
            "product_name": product["name"],
            "price": job["approved_price"],
            "stock": product["inventory"],
            "image_urls": [],
            "target_platform": job["target_platform"],
            "platform_specific_data": {},
            "variants": []
        }

        # 4. 執行 Agent 2
        listing_result = publish_product(listing_data)

        # Mock Agent 2 預期回傳 status
        publish_status = listing_result.get("status")

        if publish_status != "success":
            raise ValueError(
                f"Agent 2 returned: {listing_result}"
            )

        platform_item_id = listing_result.get(
            "listing_id"
        )

        # 5. 上架成功
        with engine.begin() as connection:
            connection.execute(
                text("""
                    UPDATE listing_jobs
                    SET
                        status = 'success',
                        platform_item_id = :platform_item_id,
                        completed_at = NOW()
                    WHERE id = :id
                      AND status = 'processing'
                """),
                {
                    "platform_item_id": (
                        str(platform_item_id)
                        if platform_item_id is not None
                        else None
                    ),
                    "id": job_id
                }
            )

        return {
            "job_id": job_id,
            "status": "success",
            "listing_result": listing_result
        }

    except Exception as exc:

        # 6. 記錄上架失敗
        with engine.begin() as connection:
            connection.execute(
                text("""
                    UPDATE listing_jobs
                    SET
                        status = 'failed',
                        error_message = :error,
                        completed_at = NOW()
                    WHERE id = :id
                      AND status = 'processing'
                """),
                {
                    "error": str(exc),
                    "id": job_id
                }
            )

        raise HTTPException(
            status_code=502,
            detail=f"Listing failed: {exc}"
        )


@router.get("/listing-jobs", response_model=list[ListingJobResponse])
def get_listing_jobs():

    with engine.connect() as connection:
        result = connection.execute(
            text("""
                SELECT *
                FROM listing_jobs
                ORDER BY id DESC
            """)
        )

        return [
            dict(row)
            for row in result.mappings()
        ]


@router.post("/listing-jobs/{job_id}/retry", response_model=ListingRetryResponse)
def retry_listing_job(job_id: int):

    with engine.begin() as connection:
        result = connection.execute(
            text("""
                UPDATE listing_jobs
                SET
                    status = 'pending',
                    error_message = NULL
                WHERE id = :id
                  AND status = 'failed'
                RETURNING id
            """),
            {"id": job_id}
        )

        updated = result.scalar_one_or_none()

        if updated is None:
            raise HTTPException(
                status_code=409,
                detail="Job not found or not in failed status"
            )

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Job is ready to retry"
    }

