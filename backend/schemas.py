"""Shared request bodies for the current API (no DB migration)."""
from typing import Any
from pydantic import BaseModel, Field

class ProductCreate(BaseModel):
    name: str
    cost: int = Field(ge=0)
    current_price: int | None = Field(default=None, ge=0)
    inventory: int = Field(ge=0)
    category: str | None = None
    brand: str | None = None
    specifications: dict[str, Any] = Field(default_factory=dict)

class ProductPriceUpdate(BaseModel):
    current_price: int = Field(ge=0)

class ReviewApprove(BaseModel):
    # null => accept suggested price; integer => override
    approved_price: int | None = Field(default=None, ge=0)

class ReviewReject(BaseModel):
    reason: str = Field(min_length=1)

# Response schemas used by backend/routers/pricing.py
from datetime import datetime

class PendingReviewResponse(BaseModel):
    review_id: int
    product_id: int
    product_name: str
    original_price: int
    suggested_price: int
    status: str
    created_at: datetime

class WorkflowRunResponse(BaseModel):
    review_id: int
    product_id: int
    product_name: str
    original_price: int
    pricing_result: dict[str, Any]
    status: str
    created_at: datetime
    message: str

class ListingJobResponse(BaseModel):
    # GET /listing-jobs returns SELECT * from listing_jobs.
    # The approve endpoint uses its own nested job_id/status shape.
    id: int
    review_id: int
    product_id: int
    approved_price: int
    target_platform: str
    status: str
    platform_item_id: str | None = None
    error_message: str | None = None
    attempts: int
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

class CreatedListingJobResponse(BaseModel):
    job_id: int
    status: str

class ReviewApproveResponse(BaseModel):
    review_id: int
    product_id: int
    approved_price: int
    status: str
    listing_job: CreatedListingJobResponse
    message: str

class ReviewRejectResponse(BaseModel):
    review_id: int
    product_id: int
    status: str
    rejection_reason: str
    message: str

# Responses returned by backend/routers/listings.py
class ListingExecuteResponse(BaseModel):
    job_id: int
    status: str
    listing_result: dict[str, Any]

class ListingRetryResponse(BaseModel):
    job_id: int
    status: str
    message: str


# Error body used by FastAPI HTTPException and main.py OpenAPI documentation.
class ErrorResponse(BaseModel):
    detail: Any
