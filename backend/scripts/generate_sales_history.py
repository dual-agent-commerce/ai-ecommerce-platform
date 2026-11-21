"""Generate synthetic weekly sales history for Sean pricing integration demos.

Output columns: product_id,period,price,units_sold
Synthetic data ONLY. Do not use for production model training.
"""
import argparse
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path


def positive_int(value):
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError('must be >= 1')
    return n


def main():
    parser = argparse.ArgumentParser(description='Generate SYNTHETIC weekly sales CSV for demos')
    parser.add_argument('--ids', help='Comma-separated product IDs, e.g. 7,8')
    parser.add_argument('--count', type=positive_int, help='Number of products (IDs default to 1..N)')
    parser.add_argument('--prices', help='Comma-separated baseline prices in product ID order')
    parser.add_argument('--weeks', type=positive_int, default=60)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--end-week', help='Last ISO week, e.g. 2026-W45; default previous completed ISO week')
    parser.add_argument('--output', default='demo_sales_history.csv')
    args = parser.parse_args()

    if args.ids:
        try:
            ids = [int(x.strip()) for x in args.ids.split(',')]
        except ValueError:
            parser.error('--ids must be comma-separated integers')
        if not ids or any(x <= 0 for x in ids) or len(ids) != len(set(ids)):
            parser.error('--ids must contain unique positive integers')
        if args.count is not None and args.count != len(ids):
            parser.error('--count must match the number of --ids')
    elif args.count:
        ids = list(range(1, args.count + 1))
    else:
        parser.error('specify --ids or --count')

    if args.prices:
        try:
            prices = [float(x.strip()) for x in args.prices.split(',')]
        except ValueError:
            parser.error('--prices must be comma-separated numbers')
        if len(prices) != len(ids) or any(not math.isfinite(x) or x <= 0 for x in prices):
            parser.error('--prices must contain one positive finite number per product')
    else:
        prices = [float(1000 * (i + 2)) for i in range(len(ids))]

    if args.end_week:
        try:
            year, week = args.end_week.split('-W')
            end_monday = date.fromisocalendar(int(year), int(week), 1)
        except (ValueError, TypeError):
            parser.error('--end-week must be a valid ISO week like 2026-W45')
    else:
        today = date.today()
        end_monday = today - timedelta(days=today.weekday() + 7)

    rng = random.Random(args.seed)
    rows = []
    for t in range(args.weeks):
        monday = end_monday - timedelta(weeks=args.weeks - 1 - t)
        iso = monday.isocalendar()
        period = f'{iso.year}-W{iso.week:02d}'
        for i, (pid, base) in enumerate(zip(ids, prices)):
            # Deliberate exploration plus seasonality: supports a demonstrable
            # price/units relationship rather than arbitrary independent noise.
            price_multiplier = 1 + rng.uniform(-0.18, 0.18)
            price = round(max(0.01, base * price_multiplier), 2)
            baseline_units = 24 + i * 7
            elasticity = 1.8 + i * 0.15
            seasonal = 1 + 0.12 * math.sin(2 * math.pi * t / 13 + i)
            expected_units = baseline_units * (base / price) ** elasticity * seasonal
            units = max(0, round(expected_units + rng.gauss(0, 3.0)))
            rows.append({'product_id': pid, 'period': period,
                         'price': f'{price:.2f}', 'units_sold': units})

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['product_id', 'period', 'price', 'units_sold'])
        writer.writeheader()
        writer.writerows(rows)
    print(f'SYNTHETIC DEMO DATA ONLY: {len(ids)} products x {args.weeks} weeks = {len(rows)} rows')
    print(f'Product IDs (in order): {ids}')
    print(f'Output: {output.resolve()}')


if __name__ == '__main__':
    main()
