"""Sean pricing bridge: one request per quote, persisted response, explicit seller selection."""
import json
import os
import re
from decimal import Decimal, ROUND_HALF_UP
from urllib import error, request as urlrequest

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from backend.database import engine

router = APIRouter(prefix="/sean-pricing", tags=["Sean Pricing"])
SEAN_URL = os.getenv("SEAN_PRICING_URL", "http://127.0.0.1:8001").rstrip("/")


class QuoteCreate(BaseModel):
    group_id: str = Field(min_length=1, max_length=64)
    product_ids: list[int] = Field(min_length=1)


class QuoteSelect(BaseModel):
    algorithm: str


def _quote(row):
    data = dict(row)
    for key in ("products_snapshot", "pricing_response"):
        if isinstance(data[key], str):
            data[key] = json.loads(data[key])
    return data


def _post_price(payload):
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(SEAN_URL + "/price", body, {"Content-Type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=20) as res:
            return json.load(res)
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Sean API HTTP {exc.code}: {detail[:400]}") from exc
    except (error.URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=f"Sean 定價服務無法連線：{exc}") from exc


@router.get("/quotes")
def list_quotes():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM sean_pricing_quotes ORDER BY id DESC LIMIT 30")).mappings().all()
    return [_quote(row) for row in rows]


@router.post("/quotes", status_code=201)
def create_quote(body: QuoteCreate):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", body.group_id):
        raise HTTPException(400, "group_id 只允許英數字、-、_")
    if len(body.product_ids) != len(set(body.product_ids)):
        raise HTTPException(400, "商品不可重複")
    # Preserve caller's order; never silently reorder Sean's positional arrays.
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, name, cost, current_price FROM products WHERE id = ANY(:ids)"),
                            {"ids": body.product_ids}).mappings().all()
        existing = conn.execute(text("SELECT products_snapshot FROM sean_pricing_quotes WHERE group_id = :gid ORDER BY id DESC LIMIT 1"),
                                {"gid": body.group_id}).scalar_one_or_none()
    # The seller must use an existing immutable group; no ad-hoc duplicate groups.
    with engine.connect() as conn:
        registered = conn.execute(text("SELECT product_ids FROM pricing_groups WHERE group_id=:gid"),
                                  {"gid": body.group_id}).scalar_one_or_none()
    if registered is None:
        raise HTTPException(404, "請先建立商品組，再取得定價")
    if isinstance(registered, str):
        registered = json.loads(registered)
    if registered != body.product_ids:
        raise HTTPException(409, "商品組成員與順序不可變更，請使用商品組管理頁")
    by_id = {p["id"]: dict(p) for p in rows}
    if len(by_id) != len(body.product_ids):
        raise HTTPException(404, "部分商品不存在")
    products = [by_id[i] for i in body.product_ids]
    if existing is not None:
        if isinstance(existing, str):
            existing = json.loads(existing)
        if [p["id"] for p in existing] != body.product_ids:
            raise HTTPException(409, "此 group_id 已建立商品組，商品與順序不得改變")
    payload = {"group_id": body.group_id, "products": [str(i) for i in body.product_ids],
               "cost": [p["cost"] for p in products]}
    # Sean requires either all current prices or none.
    if all(p["current_price"] is not None and p["current_price"] > 0 for p in products):
        payload["current_price"] = [p["current_price"] for p in products]
    result = _post_price(payload)
    if result.get("group_id") != body.group_id or not isinstance(result.get("results"), list):
        raise HTTPException(502, "Sean API 回傳格式不符合預期")
    for item in result["results"]:
        if "prices" in item and len(item["prices"]) != len(products):
            raise HTTPException(502, "Sean API 回傳價格數量不符")
    with engine.begin() as conn:
        row = conn.execute(text("""INSERT INTO sean_pricing_quotes (group_id, products_snapshot, pricing_response)
            VALUES (:gid, CAST(:products AS JSONB), CAST(:response AS JSONB)) RETURNING *"""),
            {"gid": body.group_id, "products": json.dumps(products), "response": json.dumps(result)}).mappings().one()
    # Support an existing Sean-trained model even if it was trained outside this platform.
    available = next((x for x in result["results"] if x.get("algorithm") == "ols_rr"
                      and isinstance(x.get("prices"), list)), None)
    if available:
        with engine.begin() as conn:
            conn.execute(text("""UPDATE pricing_groups SET model_available=TRUE,
                model_id=COALESCE(:model,model_id) WHERE group_id=:gid"""),
                {"gid": body.group_id, "model": available.get("model_id")})
    return _quote(row)


@router.post("/quotes/{quote_id}/select")
def select_quote(quote_id: int, body: QuoteSelect):
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM sean_pricing_quotes WHERE id=:id FOR UPDATE"), {"id": quote_id}).mappings().first()
        if row is None:
            raise HTTPException(404, "定價紀錄不存在")
        quote = _quote(row)
        if quote["selected_algorithm"] is not None or quote["rejected_at"] is not None:
            raise HTTPException(409, "此定價紀錄已完成審核，不能再次採用")
        latest_id = conn.execute(text("SELECT MAX(id) FROM sean_pricing_quotes WHERE group_id=:gid"),
                                 {"gid": quote["group_id"]}).scalar_one()
        if latest_id != quote_id:
            raise HTTPException(409, "舊的定價紀錄僅供查詢，請採用商品組最新的定價方案")
        matches = [r for r in quote["pricing_response"]["results"] if r.get("algorithm") == body.algorithm]
        if len(matches) != 1 or "prices" not in matches[0]:
            raise HTTPException(400, "所選演算法沒有可用價格")
        prices = matches[0]["prices"]
        products = quote["products_snapshot"]
        if len(prices) != len(products):
            raise HTTPException(502, "定價數量不符")
        applied = []
        for product, price in zip(products, prices):
            if isinstance(price, bool) or not isinstance(price, (int, float)) or not (0 < price < 1e12):
                raise HTTPException(502, "Sean API 回傳無效售價")
            current_row = conn.execute(
                text("SELECT current_price FROM products WHERE id=:id FOR UPDATE"),
                {"id": product["id"]}
            ).mappings().first()

            if current_row is None:
                raise HTTPException(404, "商品不存在")

            current = current_row["current_price"]

            if current != product["current_price"]:
                raise HTTPException(409, "商品已被修改，請重新產生定價建議")
            final = int(Decimal(str(price)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            if final <= 0:
                raise HTTPException(502, "價格四捨五入後無效")
            review_id = conn.execute(text("""INSERT INTO pricing_reviews
                (product_id, original_price, suggested_price, approved_price, status, reviewed_at)
                VALUES (:pid, :old, :new, :new, 'approved', NOW()) RETURNING id"""),
                {"pid": product["id"], "old": current, "new": final}).scalar_one()
            conn.execute(text("UPDATE products SET current_price=:price WHERE id=:id"),
                         {"price": final, "id": product["id"]})
            job_id = conn.execute(text("""INSERT INTO listing_jobs
                (review_id, product_id, approved_price, target_platform, status)
                VALUES (:rid, :pid, :price, 'mock_platform', 'pending') RETURNING id"""),
                {"rid": review_id, "pid": product["id"], "price": final}).scalar_one()
            applied.append({"product_id": product["id"], "approved_price": final, "review_id": review_id, "job_id": job_id})
        conn.execute(text("UPDATE sean_pricing_quotes SET selected_algorithm=:algo, selected_at=NOW() WHERE id=:id"),
                     {"algo": body.algorithm, "id": quote_id})
        conn.execute(text("""UPDATE pricing_groups SET active_algorithm=:algo,
            active_quote_id=:qid,last_applied_at=NOW() WHERE group_id=:gid"""),
            {"algo": body.algorithm, "qid": quote_id, "gid": quote["group_id"]})
    return {"quote_id": quote_id, "algorithm": body.algorithm, "applied": applied}


@router.post("/quotes/{quote_id}/reject")
def reject_quote(quote_id: int):
    """Reject a whole group quote without changing prices or creating listing jobs."""
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT selected_algorithm, rejected_at FROM sean_pricing_quotes WHERE id=:id FOR UPDATE"),
            {"id": quote_id},
        ).mappings().first()
        if row is None:
            raise HTTPException(404, "定價紀錄不存在")
        if row["selected_algorithm"] is not None or row["rejected_at"] is not None:
            raise HTTPException(409, "此定價紀錄已完成審核")
        quote_group = conn.execute(text("SELECT group_id FROM sean_pricing_quotes WHERE id=:id"),
                                   {"id": quote_id}).scalar_one()
        latest_id = conn.execute(text("SELECT MAX(id) FROM sean_pricing_quotes WHERE group_id=:gid"),
                                 {"gid": quote_group}).scalar_one()
        if latest_id != quote_id:
            raise HTTPException(409, "舊定價紀錄只能查看，不能再拒絕")
        conn.execute(
            text("UPDATE sean_pricing_quotes SET rejected_at=NOW() WHERE id=:id"),
            {"id": quote_id},
        )
    return {"quote_id": quote_id, "status": "rejected"}
