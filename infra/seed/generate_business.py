#!/usr/bin/env python3
"""generate_business.py — deterministic business-schema seed.

Generates 24 months of realistic demo company data:
  • 50 products (5 categories)
  • 5 000 customers
  • ~40 000 orders (≈1 650/month) with line items
  • ~4 000 returns (~10% of delivered orders)
  • ~6 000 support tickets
  • 120 employees

Usage (run from the repo root after postgres is up):
  python infra/seed/generate_business.py | psql "$DATABASE_URL"

The script is idempotent: it truncates the business tables before inserting.
All random data is seeded with SEED=42 for reproducibility.
"""

from __future__ import annotations

import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

SEED = 42
rng = random.Random(SEED)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

START = datetime(2023, 1, 1, tzinfo=timezone.utc)
END = datetime(2024, 12, 31, 23, 59, 59, tzinfo=timezone.utc)


def rand_dt(lo: datetime = START, hi: datetime = END) -> datetime:
    delta = (hi - lo).total_seconds()
    return lo + timedelta(seconds=rng.uniform(0, delta))


def rand_date(lo: date = date(2015, 1, 1), hi: date = date(2023, 6, 1)) -> date:
    delta = (hi - lo).days
    return lo + timedelta(days=rng.randint(0, delta))


def esc(s: str) -> str:
    return s.replace("'", "''")


def sql_str(s: str | None) -> str:
    if s is None:
        return "NULL"
    return f"'{esc(s)}'"


def sql_num(n: float | None) -> str:
    if n is None:
        return "NULL"
    return f"{n:.2f}"


def sql_bool(b: bool) -> str:
    return "TRUE" if b else "FALSE"


def sql_ts(dt: datetime | None) -> str:
    if dt is None:
        return "NULL"
    return f"'{dt.strftime('%Y-%m-%d %H:%M:%S+00')}'"


def sql_date(d: date | None) -> str:
    if d is None:
        return "NULL"
    return f"'{d.isoformat()}'"


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

CATEGORIES: dict[str, list[str]] = {
    "Electronics": ["Laptops", "Phones", "Accessories", "Audio", "Cameras"],
    "Office Supplies": ["Paper", "Writing", "Desk", "Filing", "Printers"],
    "Software": ["Productivity", "Security", "Design", "Analytics", "Cloud"],
    "Furniture": ["Desks", "Chairs", "Storage", "Lighting", "Accessories"],
    "Peripherals": ["Monitors", "Keyboards", "Mice", "Hubs", "Webcams"],
}

SEGMENTS = ["consumer", "corporate", "small_business"]
CHANNELS = ["web", "mobile", "api", "phone"]
COUNTRIES = ["US", "US", "US", "US", "US", "CA", "GB", "DE", "FR", "AU"]
CITIES = [
    "New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
    "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose",
    "Toronto", "London", "Berlin", "Paris", "Sydney",
]
ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "delivered", "delivered", "cancelled"]
RETURN_REASONS = ["defective", "wrong_item", "not_as_described", "changed_mind", "other"]
TICKET_CATS = ["billing", "shipping", "product", "account", "other"]
TICKET_PRI = ["low", "medium", "medium", "high", "critical"]
TICKET_STATUSES = ["open", "pending", "resolved", "closed"]
DEPARTMENTS = ["Engineering", "Sales", "Marketing", "Support", "Finance", "Operations", "HR", "Legal"]
LEVELS = ["ic1", "ic2", "ic3", "ic4", "mgr", "sr_mgr", "dir", "vp"]

# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------


def gen_products(n: int = 50) -> list[dict[str, Any]]:
    products = []
    pid = 1
    for cat, subs in CATEGORIES.items():
        count = n // len(CATEGORIES)
        for i in range(count):
            sub = rng.choice(subs)
            unit_p = round(rng.uniform(9.99, 1299.99), 2)
            products.append({
                "id": pid,
                "sku": f"SKU-{cat[:3].upper()}-{pid:04d}",
                "name": f"{sub} {cat} {i + 1}",
                "category": cat,
                "subcategory": sub,
                "unit_price": unit_p,
                "cost_price": round(unit_p * rng.uniform(0.35, 0.65), 2),
                "stock_qty": rng.randint(0, 500),
                "is_active": rng.random() > 0.05,
            })
            pid += 1
    return products


def gen_customers(n: int = 5000) -> list[dict[str, Any]]:
    firsts = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Skyler", "Quinn",
              "Avery", "Blake", "Drew", "Emery", "Finley", "Harper", "Indigo"]
    lasts = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
             "Wilson", "Martinez", "Anderson", "Taylor", "Thomas", "Jackson", "White"]
    customers = []
    used_emails: set[str] = set()
    for i in range(1, n + 1):
        first = rng.choice(firsts)
        last = rng.choice(lasts)
        base_email = f"{first.lower()}.{last.lower()}{i}@example.com"
        # ensure uniqueness deterministically
        email = base_email
        suffix = 0
        while email in used_emails:
            suffix += 1
            email = f"{first.lower()}.{last.lower()}{i}.{suffix}@example.com"
        used_emails.add(email)
        customers.append({
            "id": i,
            "first_name": first,
            "last_name": last,
            "email": email,
            "phone": f"+1-{rng.randint(200,999)}-{rng.randint(100,999)}-{rng.randint(1000,9999)}",
            "city": rng.choice(CITIES),
            "country": rng.choice(COUNTRIES),
            "segment": rng.choice(SEGMENTS),
            "acquired_at": rand_date(),
            "is_active": rng.random() > 0.08,
        })
    return customers


def gen_orders_and_items(
    customers: list[dict[str, Any]],
    products: list[dict[str, Any]],
    target: int = 40000,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    orders: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    oid = 1
    iid = 1
    active_cids = [c["id"] for c in customers if c["is_active"]]
    active_prods = [p for p in products if p["is_active"]]

    for _ in range(target):
        cid = rng.choice(active_cids)
        ordered_at = rand_dt()
        status = rng.choice(ORDER_STATUSES)
        n_items = rng.randint(1, 5)
        chosen = rng.sample(active_prods, min(n_items, len(active_prods)))

        subtotal = 0.0
        order_items_tmp = []
        for prod in chosen:
            qty = rng.randint(1, 4)
            up = prod["unit_price"]
            disc = round(up * rng.choice([0, 0, 0, 0.05, 0.1, 0.15]), 2)
            lt = round((up - disc) * qty, 2)
            subtotal += lt
            order_items_tmp.append({
                "id": iid,
                "order_id": oid,
                "product_id": prod["id"],
                "qty": qty,
                "unit_price": up,
                "discount": disc,
                "line_total": lt,
            })
            iid += 1

        subtotal = round(subtotal, 2)
        disc_order = round(subtotal * rng.choice([0, 0, 0.05, 0.1]), 2)
        tax = round((subtotal - disc_order) * 0.08, 2)
        total = round(subtotal - disc_order + tax, 2)

        shipped_at = None
        delivered_at = None
        if status in ("shipped", "delivered"):
            shipped_at = ordered_at + timedelta(hours=rng.uniform(24, 72))
        if status == "delivered":
            delivered_at = shipped_at + timedelta(hours=rng.uniform(24, 168))  # type: ignore[operator]

        orders.append({
            "id": oid,
            "customer_id": cid,
            "status": status,
            "channel": rng.choice(CHANNELS),
            "subtotal": subtotal,
            "discount": disc_order,
            "tax": tax,
            "total": total,
            "currency": "USD",
            "ordered_at": ordered_at,
            "shipped_at": shipped_at,
            "delivered_at": delivered_at,
        })
        items.extend(order_items_tmp)
        oid += 1

    return orders, items


def gen_returns(
    orders: list[dict[str, Any]],
    items: list[dict[str, Any]],
    rate: float = 0.10,
) -> list[dict[str, Any]]:
    delivered = [o for o in orders if o["status"] == "delivered"]
    returns = []
    rid = 1
    items_by_order: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        items_by_order.setdefault(item["order_id"], []).append(item)

    for order in delivered:
        if rng.random() > rate:
            continue
        order_items = items_by_order.get(order["id"], [])
        if not order_items:
            continue
        item = rng.choice(order_items)
        qty = rng.randint(1, item["qty"])
        returns.append({
            "id": rid,
            "order_id": order["id"],
            "product_id": item["product_id"],
            "qty": qty,
            "reason": rng.choice(RETURN_REASONS),
            "refund_amt": round(item["unit_price"] * qty * 0.9, 2),
            "returned_at": order["delivered_at"] + timedelta(days=rng.randint(1, 30)),
        })
        rid += 1
    return returns


def gen_tickets(
    customers: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    n: int = 6000,
) -> list[dict[str, Any]]:
    tickets = []
    cids = [c["id"] for c in customers]
    orders_by_cid: dict[int, list[int]] = {}
    for o in orders:
        orders_by_cid.setdefault(o["customer_id"], []).append(o["id"])

    for tid in range(1, n + 1):
        cid = rng.choice(cids)
        order_id = rng.choice(orders_by_cid.get(cid, [None]))  # type: ignore[arg-type]
        created_at = rand_dt()
        status = rng.choice(TICKET_STATUSES)
        resolved_at = None
        satisfaction = None
        if status in ("resolved", "closed"):
            resolved_at = created_at + timedelta(hours=rng.uniform(1, 72))
            if status == "resolved":
                satisfaction = rng.randint(2, 5)
            else:
                satisfaction = rng.randint(1, 5) if rng.random() > 0.3 else None
        tickets.append({
            "id": tid,
            "customer_id": cid,
            "order_id": order_id,
            "category": rng.choice(TICKET_CATS),
            "priority": rng.choice(TICKET_PRI),
            "status": status,
            "created_at": created_at,
            "resolved_at": resolved_at,
            "satisfaction": satisfaction,
        })
    return tickets


def gen_employees(n: int = 120) -> list[dict[str, Any]]:
    titles_by_level = {
        "ic1": "Associate",
        "ic2": "Analyst",
        "ic3": "Senior Analyst",
        "ic4": "Staff",
        "mgr": "Manager",
        "sr_mgr": "Senior Manager",
        "dir": "Director",
        "vp": "Vice President",
    }
    salary_by_level = {
        "ic1": (55000, 75000),
        "ic2": (75000, 100000),
        "ic3": (100000, 135000),
        "ic4": (130000, 165000),
        "mgr": (120000, 155000),
        "sr_mgr": (150000, 190000),
        "dir": (180000, 240000),
        "vp": (220000, 320000),
    }
    employees = []
    for eid in range(1, n + 1):
        level = rng.choices(
            LEVELS,
            weights=[20, 30, 20, 10, 8, 5, 4, 3],
            k=1,
        )[0]
        dept = rng.choice(DEPARTMENTS)
        lo, hi = salary_by_level[level]
        employees.append({
            "id": eid,
            "first_name": f"Emp{eid:04d}F",
            "last_name": f"Emp{eid:04d}L",
            "email": f"employee{eid:04d}@internal.example.com",
            "department": dept,
            "title": f"{dept} {titles_by_level[level]}",
            "level": level,
            "salary": round(rng.uniform(lo, hi), 2),
            "hired_at": rand_date(lo=date(2010, 1, 1), hi=date(2024, 1, 1)),
            "is_active": rng.random() > 0.1,
        })
    return employees


# ---------------------------------------------------------------------------
# SQL emitters
# ---------------------------------------------------------------------------


def emit_truncate() -> str:
    return """
-- Seed is idempotent: wipe in dependency order before re-inserting.
TRUNCATE business.support_tickets RESTART IDENTITY CASCADE;
TRUNCATE business.returns         RESTART IDENTITY CASCADE;
TRUNCATE business.order_items     RESTART IDENTITY CASCADE;
TRUNCATE business.orders          RESTART IDENTITY CASCADE;
TRUNCATE business.customers       RESTART IDENTITY CASCADE;
TRUNCATE business.employees       RESTART IDENTITY CASCADE;
TRUNCATE business.products        RESTART IDENTITY CASCADE;
"""


def emit_products(products: list[dict[str, Any]]) -> str:
    rows = []
    for p in products:
        rows.append(
            f"({p['id']},{sql_str(p['sku'])},{sql_str(p['name'])},"
            f"{sql_str(p['category'])},{sql_str(p['subcategory'])},"
            f"{sql_num(p['unit_price'])},{sql_num(p['cost_price'])},"
            f"{p['stock_qty']},{sql_bool(p['is_active'])})"
        )
    return "INSERT INTO business.products (id,sku,name,category,subcategory,unit_price,cost_price,stock_qty,is_active) VALUES\n" + ",\n".join(rows) + ";\n"


def emit_customers(customers: list[dict[str, Any]]) -> str:
    rows = []
    for c in customers:
        rows.append(
            f"({c['id']},{sql_str(c['first_name'])},{sql_str(c['last_name'])},"
            f"{sql_str(c['email'])},{sql_str(c['phone'])},"
            f"{sql_str(c['city'])},{sql_str(c['country'])},{sql_str(c['segment'])},"
            f"{sql_date(c['acquired_at'])},{sql_bool(c['is_active'])})"
        )
    return "INSERT INTO business.customers (id,first_name,last_name,email,phone,city,country,segment,acquired_at,is_active) VALUES\n" + ",\n".join(rows) + ";\n"


def emit_employees(employees: list[dict[str, Any]]) -> str:
    rows = []
    for e in employees:
        rows.append(
            f"({e['id']},{sql_str(e['first_name'])},{sql_str(e['last_name'])},"
            f"{sql_str(e['email'])},{sql_str(e['department'])},{sql_str(e['title'])},"
            f"{sql_str(e['level'])},{sql_num(e['salary'])},{sql_date(e['hired_at'])},"
            f"{sql_bool(e['is_active'])})"
        )
    return "INSERT INTO business.employees (id,first_name,last_name,email,department,title,level,salary,hired_at,is_active) VALUES\n" + ",\n".join(rows) + ";\n"


def emit_orders(orders: list[dict[str, Any]]) -> str:
    # Batch in chunks of 500 to keep statement size manageable
    lines = []
    batch_size = 500
    for start in range(0, len(orders), batch_size):
        batch = orders[start : start + batch_size]
        rows = []
        for o in batch:
            rows.append(
                f"({o['id']},{o['customer_id']},{sql_str(o['status'])},"
                f"{sql_str(o['channel'])},{sql_num(o['subtotal'])},"
                f"{sql_num(o['discount'])},{sql_num(o['tax'])},{sql_num(o['total'])},"
                f"'USD',{sql_ts(o['ordered_at'])},{sql_ts(o['shipped_at'])},{sql_ts(o['delivered_at'])})"
            )
        lines.append(
            "INSERT INTO business.orders (id,customer_id,status,channel,subtotal,discount,tax,total,currency,ordered_at,shipped_at,delivered_at) VALUES\n"
            + ",\n".join(rows)
            + ";\n"
        )
    return "".join(lines)


def emit_order_items(items: list[dict[str, Any]]) -> str:
    lines = []
    batch_size = 1000
    for start in range(0, len(items), batch_size):
        batch = items[start : start + batch_size]
        rows = []
        for i in batch:
            rows.append(
                f"({i['id']},{i['order_id']},{i['product_id']},"
                f"{i['qty']},{sql_num(i['unit_price'])},{sql_num(i['discount'])},{sql_num(i['line_total'])})"
            )
        lines.append(
            "INSERT INTO business.order_items (id,order_id,product_id,qty,unit_price,discount,line_total) VALUES\n"
            + ",\n".join(rows)
            + ";\n"
        )
    return "".join(lines)


def emit_returns(returns: list[dict[str, Any]]) -> str:
    if not returns:
        return ""
    rows = []
    for r in returns:
        rows.append(
            f"({r['id']},{r['order_id']},{r['product_id']},"
            f"{r['qty']},{sql_str(r['reason'])},{sql_num(r['refund_amt'])},"
            f"{sql_ts(r['returned_at'])})"
        )
    return "INSERT INTO business.returns (id,order_id,product_id,qty,reason,refund_amt,returned_at) VALUES\n" + ",\n".join(rows) + ";\n"


def emit_tickets(tickets: list[dict[str, Any]]) -> str:
    lines = []
    batch_size = 500
    for start in range(0, len(tickets), batch_size):
        batch = tickets[start : start + batch_size]
        rows = []
        for t in batch:
            sat = str(t["satisfaction"]) if t["satisfaction"] is not None else "NULL"
            rows.append(
                f"({t['id']},{t['customer_id']},{t['order_id'] if t['order_id'] else 'NULL'},"
                f"{sql_str(t['category'])},{sql_str(t['priority'])},{sql_str(t['status'])},"
                f"{sql_ts(t['created_at'])},{sql_ts(t['resolved_at'])},{sat})"
            )
        lines.append(
            "INSERT INTO business.support_tickets (id,customer_id,order_id,category,priority,status,created_at,resolved_at,satisfaction) VALUES\n"
            + ",\n".join(rows)
            + ";\n"
        )
    return "".join(lines)


# ---------------------------------------------------------------------------
# Sequence resets (so SERIAL sequences start after our explicit IDs)
# ---------------------------------------------------------------------------


def emit_sequence_resets(
    products: list[dict[str, Any]],
    customers: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    items: list[dict[str, Any]],
    returns: list[dict[str, Any]],
    tickets: list[dict[str, Any]],
    employees: list[dict[str, Any]],
) -> str:
    return f"""
SELECT setval(pg_get_serial_sequence('business.products', 'id'), {max(p['id'] for p in products)});
SELECT setval(pg_get_serial_sequence('business.customers', 'id'), {max(c['id'] for c in customers)});
SELECT setval(pg_get_serial_sequence('business.orders', 'id'), {max(o['id'] for o in orders)});
SELECT setval(pg_get_serial_sequence('business.order_items', 'id'), {max(i['id'] for i in items)});
SELECT setval(pg_get_serial_sequence('business.returns', 'id'), {max(r['id'] for r in returns) if returns else 1});
SELECT setval(pg_get_serial_sequence('business.support_tickets', 'id'), {max(t['id'] for t in tickets)});
SELECT setval(pg_get_serial_sequence('business.employees', 'id'), {max(e['id'] for e in employees)});
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    out = sys.stdout

    out.write("-- Verity business-schema seed (deterministic, SEED=42)\n")
    out.write("-- Generated by infra/seed/generate_business.py\n\n")
    out.write("BEGIN;\n\n")
    out.write(emit_truncate())
    out.write("\n")

    products = gen_products(50)
    customers = gen_customers(5000)
    employees = gen_employees(120)
    orders, items = gen_orders_and_items(customers, products, target=40000)
    returns = gen_returns(orders, items)
    tickets = gen_tickets(customers, orders, n=6000)

    out.write(emit_products(products))
    out.write("\n")
    out.write(emit_customers(customers))
    out.write("\n")
    out.write(emit_employees(employees))
    out.write("\n")
    out.write(emit_orders(orders))
    out.write("\n")
    out.write(emit_order_items(items))
    out.write("\n")
    out.write(emit_returns(returns))
    out.write("\n")
    out.write(emit_tickets(tickets))
    out.write("\n")
    out.write(emit_sequence_resets(products, customers, orders, items, returns, tickets, employees))
    out.write("\nCOMMIT;\n")

    totals = {
        "products": len(products),
        "customers": len(customers),
        "employees": len(employees),
        "orders": len(orders),
        "order_items": len(items),
        "returns": len(returns),
        "tickets": len(tickets),
    }
    print(f"\n-- Seed summary: {totals}", file=sys.stderr)


if __name__ == "__main__":
    main()
