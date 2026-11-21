"""Read-only endpoint connectivity/route smoke checks. No DB mutations."""
import json
import os
import sys
from urllib import request, error

PLATFORM = os.getenv("PLATFORM_API_URL", "http://127.0.0.1:8000").rstrip("/")
SEAN = os.getenv("SEAN_PRICING_URL", "http://127.0.0.1:8001").rstrip("/")


def check(label, url, verify=None):
    try:
        with request.urlopen(url, timeout=7) as r:
            data = json.load(r)
        if verify and not verify(data):
            print(f"[FAIL] {label}: 200 but unexpected JSON")
            return False
        print(f"[OK]   {label}")
        return True
    except error.HTTPError as exc:
        print(f"[FAIL] {label}: HTTP {exc.code} — if 500, check SQL migration and backend console")
    except Exception as exc:
        print(f"[FAIL] {label}: {exc}")
    return False


def main():
    ok = [
        check("Platform health", PLATFORM + "/", lambda d: "message" in d),
        check("Products", PLATFORM + "/products", lambda d: isinstance(d, list)),
        check("Pricing groups (migration 003)", PLATFORM + "/sean-pricing/groups", lambda d: isinstance(d, list)),
        check("Model-ready notifications", PLATFORM + "/sean-pricing/notifications", lambda d: isinstance(d, list)),
        check("Pricing API routes", PLATFORM + "/openapi.json", lambda d: "/sean-pricing/training/weekly" in d["paths"]),
        check("Sean real service", SEAN + "/openapi.json", lambda d: "/price" in d["paths"]),
    ]
    print(f"\n{sum(ok)}/{len(ok)} checks passed")
    if not all(ok):
        sys.exit(1)


if __name__ == "__main__":
    main()
