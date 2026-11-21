"""Manual or Windows Task Scheduler maintenance for Sean's pricing API.

Usage from ai-ecommerce-platform project root:
    python -m backend.scripts.sean_maintenance train
    python -m backend.scripts.sean_maintenance poll
    python -m backend.scripts.sean_maintenance import-csv --file actual_sales.csv
    python -m backend.scripts.sean_maintenance demo-import --group-id grp_... --file 06_train_started_request.json

This script talks to YOUR Platform API (8000), never directly to Sean (8001).
Demo-import is synthetic test data and must NOT be used as real sales history.
"""
import argparse
import csv
import json
import os
import sys
from statistics import median
from urllib import request, error

BASE_URL = os.getenv("PLATFORM_API_URL", "http://127.0.0.1:8000").rstrip("/")


def api(method, path, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if os.getenv("SEAN_ADMIN_TOKEN"):
        headers["X-Admin-Token"] = os.environ["SEAN_ADMIN_TOKEN"]
    req = request.Request(BASE_URL + path, method=method, data=body, headers=headers)
    try:
        with request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except error.HTTPError as exc:
        raise RuntimeError(f"Platform HTTP {exc.code}: {exc.read().decode('utf8', 'replace')[:500]}") from exc


def main():
    parser = argparse.ArgumentParser(description="Sean training maintenance, local developer tool")
    parser.add_argument("action", choices=["train", "poll", "import-csv", "demo-import"])
    parser.add_argument("--file", help="CSV file or Sean's sample 06_train_started_request.json")
    parser.add_argument("--group-id", help="Required for demo-import")
    parser.add_argument("--confirm-demo", action="store_true", help="Explicitly acknowledge that demo sample sales are artificial")
    args = parser.parse_args()
    if args.action == "train":
        data = api("POST", "/sean-pricing/training/weekly")
    elif args.action == "poll":
        data = api("POST", "/sean-pricing/training/poll")
    elif args.action == "import-csv":
        if not args.file:
            parser.error("import-csv requires --file")
        with open(args.file, newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        required = {"product_id", "period", "price", "units_sold"}
        if rows and not required.issubset(rows[0].keys()):
            parser.error("CSV headers must contain: product_id,period,price,units_sold")
        all_data = []
        for i in range(0, len(rows), 5000):
            all_data.append(api("POST", "/sean-pricing/sales-history/import", {"rows": rows[i:i+5000]}))
        data = {"total_imported": sum(r["imported"] for r in all_data)}
    else:
        if not args.file or not args.group_id:
            parser.error("demo-import requires both --file and --group-id")
        if not args.confirm_demo:
            parser.error("demo-import uses ARTIFICIAL sales. Add --confirm-demo only in your test database.")
        with open(args.file, encoding="utf-8-sig") as handle:
            sample = json.load(handle)
        groups = api("GET", "/sean-pricing/groups")
        group = next((g for g in groups if g["group_id"] == args.group_id), None)
        if group is None:
            parser.error("Group not found")
        if len(group["product_ids"]) != len(sample["products"]):
            parser.error(f"Sample has {len(sample['products'])} products but group has {len(group['product_ids'])}")
        print("\n*** WARNING: IMPORTING DEMONSTRATION DATA, NOT REAL SALES! ***\n")
        # Normalize the toy sample's currencies around each product's CURRENT listing price.
        # Still synthetic: only a model API smoke test; never claim these are actual sales.
        product_count = len(group["product_ids"])
        centers = [median(period["price"][i] for period in sample["history"]) for i in range(product_count)]
        targets = [max(float(p.get("current_price") or 0), float(p.get("cost") or 0) * 1.3, 1.0)
                   for p in group["products"]]
        factors = [targets[i] / centers[i] for i in range(product_count)]
        rows = [{"product_id": pid, "period": period["period"],
                 "price": round(period["price"][i] * factors[i], 2), "units_sold": period["units"][i]}
                for period in sample["history"] for i, pid in enumerate(group["product_ids"])]
        data = {"group_id": args.group_id,
                "import": api("POST", "/sean-pricing/sales-history/import", {"rows": rows}),
                "source": "SEAN EXAMPLE / SYNTHETIC FOR TESTING ONLY"}
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
