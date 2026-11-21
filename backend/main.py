"""FastAPI entry point. Business endpoints live in backend/routers/."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from backend.routers import products, pricing, listings, sean_pricing, sean_groups
from backend.schemas import ErrorResponse

app = FastAPI(title="AI E-commerce API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["Health"])
def root():
    return {"message": "AI E-commerce API is running"}


app.include_router(products.router)
app.include_router(pricing.router)
app.include_router(listings.router)
app.include_router(sean_pricing.router)
app.include_router(sean_groups.router)

# OpenAPI documentation only; actual endpoint behavior is unchanged.
ERROR_STATUSES: dict[tuple[str, str], tuple[int, ...]] = {
    ("GET", "/products/{product_id}"): (404,),
    ("PATCH", "/products/{product_id}/price"): (404,),
    ("DELETE", "/products/{product_id}"): (404,),
    ("POST", "/workflow/{product_id}"): (404, 502),
    ("POST", "/workflow/reviews/{review_id}/approve"): (404, 409),
    ("POST", "/workflow/reviews/{review_id}/reject"): (404, 409),
    ("POST", "/listing-jobs/{job_id}/execute"): (404, 409, 502),
    ("POST", "/listing-jobs/{job_id}/retry"): (409,),
}


def custom_openapi():
    if app.openapi_schema is not None:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )

    schema.setdefault("components", {}).setdefault("schemas", {})[
        "ErrorResponse"
    ] = ErrorResponse.model_json_schema(
        ref_template="#/components/schemas/{model}"
    )

    descriptions = {
        404: "Resource not found",
        409: "Operation conflicts with current resource state",
        502: "Agent execution failed or returned invalid data",
    }

    for (method, path), statuses in ERROR_STATUSES.items():
        operation = schema.get("paths", {}).get(path, {}).get(method.lower())
        if operation is None:
            continue

        responses = operation.setdefault("responses", {})
        for status in statuses:
            responses[str(status)] = {
                "description": descriptions[status],
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/ErrorResponse"}
                    }
                },
            }

    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi
