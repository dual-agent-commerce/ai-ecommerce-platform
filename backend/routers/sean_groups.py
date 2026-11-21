"""Seller pricing groups, weekly Sean training, and persistent model-ready notices.

Run migration 003 first. Training maintenance is invoked by an EXTERNAL scheduler,
not by a FastAPI request timer (which would duplicate on --reload/workers).
"""
from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from urllib import error, request as urlrequest

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.database import engine

router = APIRouter(prefix="/sean-pricing", tags=["Sean Pricing Groups & Training"])
SEAN_URL = os.getenv("SEAN_PRICING_URL", "http://127.0.0.1:8001").rstrip("/")
ACTIVE_STATES = ("training", "running")


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    product_ids: list[int] = Field(min_length=1, max_length=100)


class GroupRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class HistoryItem(BaseModel):
    product_id: int = Field(gt=0)
    period: str = Field(min_length=1, max_length=32)
    price: Decimal = Field(gt=0)
    units_sold: int = Field(ge=0)


class HistoryImport(BaseModel):
    rows: list[HistoryItem] = Field(min_length=1, max_length=5000)


def _admin_only(req: Request, token: str | None = None):
    """Local dev allowed; on non-local requests require SEAN_ADMIN_TOKEN."""
    expected = os.getenv("SEAN_ADMIN_TOKEN")
    if expected:
        if not token or not secrets.compare_digest(token, expected):
            raise HTTPException(403, "系統管理操作需要正確的 X-Admin-Token")
    elif req.client is None or req.client.host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "尚未設定 SEAN_ADMIN_TOKEN；只允許本機管理操作")


def _sean_call(method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(SEAN_URL + path, data=data, method=method,
                             headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=25) as resp:
            return resp.status, json.load(resp)
    except error.HTTPError as exc:
        if exc.code == 404 and method == "GET":
            return 404, {"error": {"code": "not_found"}}
        payload = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(502, f"Sean API HTTP {exc.code}: {payload[:300]}") from exc
    except (error.URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(503, f"Sean API 暫時無法連線：{exc}") from exc


def _record(row):
    if row is None:
        return None
    d = dict(row)
    for key in ("product_ids", "products_snapshot", "pricing_response", "missing", "last_train_missing"):
        if key in d and isinstance(d[key], str):
            d[key] = json.loads(d[key])
    return d


def _get_group(conn, group_id: str, lock=False):
    clause = " FOR UPDATE" if lock else ""
    g = conn.execute(text("SELECT * FROM pricing_groups WHERE group_id=:gid" + clause),
                     {"gid": group_id}).mappings().first()
    if not g:
        raise HTTPException(404, "商品組不存在")
    return _record(g)


def _fetch_group(conn, g):
    ids = [int(x) for x in g["product_ids"]]
    rows = conn.execute(text("SELECT id, name, cost, current_price, inventory FROM products WHERE id = ANY(:ids)"),
                        {"ids": ids}).mappings().all()
    by_id = {r["id"]: dict(r) for r in rows}
    return [by_id.get(i, {"id": i, "name": f"已移除商品 #{i}", "missing": True}) for i in ids]


def _group_payload(conn, row):
    group = _record(row)
    group["products"] = _fetch_group(conn, group)
    quote_row = conn.execute(text("SELECT * FROM sean_pricing_quotes WHERE group_id=:gid ORDER BY id DESC LIMIT 1"),
                             {"gid": group["group_id"]}).mappings().first()
    group["latest_quote"] = _record(quote_row)
    history = conn.execute(text("SELECT * FROM pricing_training_runs WHERE group_id=:gid ORDER BY id DESC LIMIT 1"),
                           {"gid": group["group_id"]}).mappings().first()
    group["latest_training"] = _record(history)
    return group


@router.get("/groups")
def list_groups():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM pricing_groups WHERE archived_at IS NULL ORDER BY created_at DESC, group_id")).mappings().all()
        return [_group_payload(conn, row) for row in rows]


@router.post("/groups", status_code=201)
def create_group(body: GroupCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "請輸入商品組名稱")
    ids = sorted(body.product_ids)  # one immutable order across /price and /train
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "商品不能重複")
    with engine.begin() as conn:
        count = conn.execute(text("SELECT count(*) FROM products WHERE id = ANY(:ids)"), {"ids": ids}).scalar_one()
        if count != len(ids):
            raise HTTPException(404, "部分商品不存在")
        existing = conn.execute(text("SELECT group_id, product_ids FROM pricing_groups")).mappings().all()
        if any(list(g["product_ids"]) == ids for g in existing):
            raise HTTPException(409, "這些商品已經有完全相同的定價商品組，請直接使用既有商品組")
        group_id = "grp_" + secrets.token_hex(10)
        conn.execute(text("INSERT INTO pricing_groups(group_id,name,product_ids) VALUES (:gid,:name,CAST(:ids AS JSONB))"),
                     {"gid": group_id, "name": name, "ids": json.dumps(ids)})
        return _group_payload(conn, _get_group(conn, group_id))


@router.patch("/groups/{group_id}")
def rename_group(group_id: str, body: GroupRename):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "請輸入商品組名稱")
    with engine.begin() as conn:
        _get_group(conn, group_id)
        conn.execute(text("UPDATE pricing_groups SET name=:name WHERE group_id=:gid"),
                     {"gid": group_id, "name": name})
        return _group_payload(conn, _get_group(conn, group_id))


@router.post("/groups/{group_id}/archive")
def archive_group(group_id: str):
    """Hide a test/retired group; keep historical quotes and listing audit intact."""
    with engine.begin() as conn:
        _get_group(conn, group_id)
        active = conn.execute(text("SELECT count(*) FROM pricing_training_runs WHERE group_id=:gid AND status IN ('training','running')"),
                              {"gid": group_id}).scalar_one()
        if active:
            raise HTTPException(409, "此組仍在訓練中，完成後再封存")
        conn.execute(text("UPDATE pricing_groups SET archived_at=NOW() WHERE group_id=:gid"), {"gid": group_id})
    return {"group_id": group_id, "status": "archived"}


@router.post("/groups/{group_id}/restore")
def restore_group(group_id: str):
    """Restore an archived group (available through /docs; never deletes quotes)."""
    with engine.begin() as conn:
        _get_group(conn, group_id)
        conn.execute(text("UPDATE pricing_groups SET archived_at=NULL WHERE group_id=:gid"), {"gid": group_id})
    return {"group_id": group_id, "status": "active"}


@router.get("/groups/{group_id}/quotes")
def group_quote_history(group_id: str):
    with engine.connect() as conn:
        _get_group(conn, group_id)
        rows = conn.execute(text("SELECT * FROM sean_pricing_quotes WHERE group_id=:gid ORDER BY id DESC LIMIT 15"),
                            {"gid": group_id}).mappings().all()
        return [_record(row) for row in rows]


@router.get("/notifications")
def list_notifications():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM pricing_notifications ORDER BY created_at DESC, id DESC LIMIT 30")).mappings().all()
        return [dict(row) for row in rows]


@router.post("/notifications/{notice_id}/read")
def read_notification(notice_id: int):
    with engine.begin() as conn:
        n = conn.execute(text("UPDATE pricing_notifications SET read_at=NOW() WHERE id=:id RETURNING id"),
                         {"id": notice_id}).scalar_one_or_none()
        if n is None:
            raise HTTPException(404, "通知不存在")
    return {"id": notice_id, "status": "read"}


@router.post("/sales-history/import")
def import_sales_history(body: HistoryImport, request: Request, x_admin_token: str | None = Header(default=None)):
    """Import REAL transaction-derived weekly aggregates; never fabricate sales records."""
    _admin_only(request, x_admin_token)
    keys = [(r.product_id, r.period) for r in body.rows]
    if len(keys) != len(set(keys)):
        raise HTTPException(400, "同一商品同一期銷售紀錄不可重複")
    for row in body.rows:
        if not re.fullmatch(r"\d{4}-W\d{2}", row.period):
            raise HTTPException(400, f"期別格式應為 YYYY-Www：{row.period}")
    with engine.begin() as conn:
        for row in body.rows:
            conn.execute(text("""INSERT INTO sales_history (product_id,period,price,units_sold)
                VALUES (:pid,:period,:price,:units)
                ON CONFLICT(product_id,period) DO UPDATE SET price=EXCLUDED.price, units_sold=EXCLUDED.units_sold"""),
                {"pid": row.product_id, "period": row.period, "price": row.price, "units": row.units_sold})
    return {"imported": len(body.rows), "message": "歷史實際成交價格與銷量已保存"}


def _save_not_ready(conn, group_id, period, missing, *, status="not_ready"):
    row = conn.execute(text("""INSERT INTO pricing_training_runs(group_id,period,status,missing,completed_at)
        VALUES (:gid,:period,:status,CAST(:missing AS JSONB),NOW()) RETURNING *"""),
        {"gid": group_id, "period": period, "status": status, "missing": json.dumps(missing)}).mappings().one()
    conn.execute(text("""UPDATE pricing_groups SET last_train_status=:status, last_train_period=:period,
        last_train_missing=CAST(:missing AS JSONB),last_train_at=NOW() WHERE group_id=:gid"""),
        {"gid": group_id, "status": status, "period": period, "missing": json.dumps(missing)})
    return _record(row)


def _build_history(conn, ids):
    rows = conn.execute(text("""SELECT product_id,period,price,units_sold FROM sales_history
        WHERE product_id=ANY(:ids) ORDER BY period ASC,product_id ASC"""), {"ids": ids}).mappings().all()
    if not rows:
        return None, [{"check": "sales_history", "message": "尚未匯入任何實際每週銷售紀錄"}], None
    by_period: dict[str, dict[int, dict]] = {}
    for r in rows:
        by_period.setdefault(r["period"], {})[r["product_id"]] = dict(r)
    last_period = sorted(by_period)[-1]
    missing = []
    for period, series in by_period.items():
        absent = [pid for pid in ids if pid not in series]
        if absent:
            missing.append({"check": "incomplete_period", "period": period,
                            "product_ids": absent, "message": "此週部分商品缺少實際成交資料（銷量為 0 也要填）"})
    if missing:
        return None, missing, last_period
    history = []
    for period in sorted(by_period):
        items = by_period[period]
        history.append({"period": period, "price": [float(items[i]["price"]) for i in ids],
                        "units": [items[i]["units_sold"] for i in ids]})
    return history, [], last_period


def _submit_training(group_id: str):
    with engine.connect() as conn:
        group = _get_group(conn, group_id)
        ids = [int(i) for i in group["product_ids"]]
        products = _fetch_group(conn, group)
        if any(p.get("missing") for p in products):
            raise HTTPException(409, "此組包含已刪除的商品，無法訓練")
        history, missing, period = _build_history(conn, ids)
        current = conn.execute(text("""SELECT * FROM pricing_training_runs WHERE group_id=:gid
            ORDER BY id DESC LIMIT 1"""), {"gid": group_id}).mappings().first()
        if current and current["status"] in ACTIVE_STATES:
            return {"group_id": group_id, "status": current["status"], "job_id": current["job_id"], "skipped": True}
        # One training submission per data period, even if Sean said not_ready.
        # New data next week => next period => eligible again.
        if current and current["period"] == period:
            return {"group_id": group_id, "status": current["status"], "period": period,
                    "missing": current["missing"], "skipped": True}
        if not history:
            with engine.begin() as tx:
                saved = _save_not_ready(tx, group_id, period, missing)
            return {"group_id": group_id, "status": "not_ready", "missing": missing, "run_id": saved["id"]}
        payload = {"group_id": group_id, "products": [str(i) for i in ids],
                   "cost": [p["cost"] for p in products], "history": history}
    # Don't hold a DB transaction during network IO.
    http_status, result = _sean_call("POST", "/train", payload)
    if result.get("group_id") != group_id:
        raise HTTPException(502, "Sean /train 回傳的 group_id 不一致")
    status = result.get("status")
    if status not in ("not_ready", "training"):
        raise HTTPException(502, "Sean /train 回傳未知狀態")
    if status == "training" and (http_status != 202 or not result.get("job_id")):
        raise HTTPException(502, "Sean /train 回傳 training 卻沒有 job_id")
    if status == "not_ready" and http_status != 200:
        raise HTTPException(502, "Sean /train 的 not_ready 狀態碼不符")
    with engine.begin() as conn:
        saved = conn.execute(text("""INSERT INTO pricing_training_runs (group_id,period,status,job_id,missing)
            VALUES (:gid,:period,:status,:job,CAST(:missing AS JSONB)) RETURNING id"""),
            {"gid": group_id, "period": period, "status": status, "job": result.get("job_id"),
             "missing": json.dumps(result.get("missing")) if result.get("missing") is not None else None}).scalar_one()
        conn.execute(text("""UPDATE pricing_groups SET last_train_status=:status, last_train_period=:period,
             last_train_missing=CAST(:missing AS JSONB),last_train_at=NOW() WHERE group_id=:gid"""),
             {"gid": group_id, "status": status, "period": period,
              "missing": json.dumps(result.get("missing")) if result.get("missing") is not None else None})
    return {"group_id": group_id, "run_id": saved, **result}


@router.post("/groups/{group_id}/train")
def train_group(group_id: str, request: Request, x_admin_token: str | None = Header(default=None)):
    _admin_only(request, x_admin_token)
    return _submit_training(group_id)


@router.post("/training/weekly")
def train_all_groups(request: Request, x_admin_token: str | None = Header(default=None)):
    _admin_only(request, x_admin_token)
    with engine.connect() as conn:
        groups = conn.execute(text("SELECT group_id FROM pricing_groups WHERE archived_at IS NULL ORDER BY group_id")).scalars().all()
    results = []
    for group_id in groups:
        try:
            results.append(_submit_training(group_id))
        except Exception as exc:
            # Independent groups: one failure must not prevent other groups from training.
            results.append({"group_id": group_id, "status": "error", "message": str(exc)[:350]})
    return {"groups": len(groups), "results": results}


def _poll_one(run):
    run = _record(run)
    now = datetime.now(timezone.utc)
    if now - run["created_at"] > timedelta(hours=2):
        status, result = "timed_out", {}
    else:
        try:
            http_status, result = _sean_call("GET", "/jobs/" + run["job_id"])
            if http_status == 404:
                status = "not_found"
            else:
                status = result.get("status")
                if result.get("group_id") != run["group_id"]:
                    status = "failed"
                    result = {"error": {"message": "Sean job group_id 不一致"}}
                elif status == "done" and not result.get("model_id"):
                    status = "failed"
                    result = {"error": {"message": "Sean job done 但沒有 model_id"}}
        except HTTPException as exc:
            with engine.begin() as conn:
                conn.execute(text("""UPDATE pricing_training_runs SET poll_errors=poll_errors+1,
                    error_message=:err, updated_at=NOW() WHERE id=:id"""),
                    {"id": run["id"], "err": exc.detail})
                if run["poll_errors"] >= 7:
                    conn.execute(text("""UPDATE pricing_training_runs SET status='failed',completed_at=NOW() WHERE id=:id"""),
                                 {"id": run["id"]})
                    conn.execute(text("UPDATE pricing_groups SET last_train_status='failed' WHERE group_id=:gid"),
                                 {"gid": run["group_id"]})
                    return {"group_id": run["group_id"], "status": "failed", "message": "查詢訓練狀態多次失敗"}
            return {"group_id": run["group_id"], "status": "retry_later"}
    if status not in ("running", "training", "done", "failed", "not_found", "timed_out"):
        return {"group_id": run["group_id"], "status": "unknown", "message": "Sean 回傳未知工作狀態"}
    if status in ACTIVE_STATES:
        with engine.begin() as conn:
            conn.execute(text("UPDATE pricing_training_runs SET status=:status,updated_at=NOW(),poll_errors=0 WHERE id=:id"),
                         {"status": status, "id": run["id"]})
        return {"group_id": run["group_id"], "status": status}
    with engine.begin() as conn:
        # UPDATE ... WHERE status active prevents duplicate notifications after polling races.
        changed = conn.execute(text("""UPDATE pricing_training_runs SET status=:status, model_id=:model,
            previous_model_id=:previous, error_message=:err, updated_at=NOW(), completed_at=NOW()
            WHERE id=:id AND status IN ('training','running') RETURNING id"""),
            {"status": status, "model": result.get("model_id"), "previous": result.get("previous_model_id"),
             "err": result.get("error", {}).get("message") if isinstance(result.get("error"), dict) else None,
             "id": run["id"]}).scalar_one_or_none()
        if changed is None:
            return {"group_id": run["group_id"], "status": status, "already_handled": True}
        if status == "done" and result.get("model_id"):
            conn.execute(text("""UPDATE pricing_groups SET model_id=:model,model_available=TRUE,
                last_train_status='done',last_train_missing=NULL WHERE group_id=:gid"""),
                {"model": result["model_id"], "gid": run["group_id"]})
            is_first = result.get("previous_model_id") is None
            title = "OLS + RR 模型已解鎖！" if is_first else "OLS + RR 模型已更新"
            message = ("商品組已具備模型定價能力，重新取得定價即可選擇金色方案。" if is_first
                       else "新模型已訓練完成，重新取得定價可使用最新版本。")
            conn.execute(text("""INSERT INTO pricing_notifications
                (group_id,training_run_id,kind,title,message) VALUES (:gid,:run,:kind,:title,:message)
                ON CONFLICT (training_run_id) DO NOTHING"""),
                {"gid": run["group_id"], "run": run["id"], "kind": "model_ready" if is_first else "model_updated",
                 "title": title, "message": message})
        else:
            conn.execute(text("UPDATE pricing_groups SET last_train_status=:status WHERE group_id=:gid"),
                         {"status": status, "gid": run["group_id"]})
    return {"group_id": run["group_id"], "status": status, "model_id": result.get("model_id")}


@router.post("/training/poll")
def poll_active_jobs(request: Request, x_admin_token: str | None = Header(default=None)):
    _admin_only(request, x_admin_token)
    with engine.connect() as conn:
        jobs = conn.execute(text("""SELECT * FROM pricing_training_runs
            WHERE status IN ('training','running') ORDER BY created_at LIMIT 25""")).mappings().all()
    return {"checked": len(jobs), "results": [_poll_one(job) for job in jobs]}
