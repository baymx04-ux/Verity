"""SQL generator — structured LLM call that produces a SQL query or clarification.

The LLM is asked to respond with a strict JSON object. The schema catalog and
few-shot examples are supplied in the prompt so the model sees only vetted
views, relationships, and admin-edited descriptions.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date

from app.llm.base import LLMClient, LLMError

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are the text-to-SQL component of Verity, an enterprise analytics assistant.

Translate the user's question into ONE safe PostgreSQL SELECT query against the
read-only business_ro schema, or ask a clarification question when the request
is genuinely ambiguous or cannot be answered from the available views.

REFERENCE DATE: {reference_date}
Treat that date as "today". Do not use CURRENT_DATE, CURRENT_TIMESTAMP, or now().
Use explicit date literals (for example DATE '2026-09-30') so the demo dataset
answers date-relative questions consistently.

RULES — follow every one exactly:
1. Query only these views (fully qualified in the SQL):
{view_list}

2. Respond with a single JSON object and nothing else:
   - SQL answer: {{"type":"sql","sql":"<single SELECT statement>"}}
   - Clarification: {{"type":"clarification","clarification":"<short question>"}}

3. The SQL must:
   - Be a single SELECT or WITH … SELECT statement
   - Reference only the allowed business_ro views
   - Include a LIMIT of 200 or less
   - Use explicit JOIN … ON … conditions (no comma or CROSS joins)
   - Avoid DML, DDL, COPY, transactions, and system/file/network functions
   - Use at most 5 joins, 8 relations, and 3 levels of subqueries

4. For date questions, use the fixed reference date above. For "last month"
   use the full calendar month immediately before the reference date.

5. Never invent tables or columns. If the available schema cannot answer the
   question, ask a clarification instead of guessing.
"""

_VIEW_LIST = """\
  - business_ro.v_regions
      (id, name, country)
  - business_ro.v_customers
      (id, region_id, region_name, segment, acquired_at, is_active)
  - business_ro.v_products
      (id, sku, name, category, subcategory, unit_price, stock_qty, is_active, created_date)
  - business_ro.v_orders
      (id, customer_id, region_id, region_name, status, channel, subtotal, discount,
       tax, total, currency, ordered_at, shipped_at, delivered_at)
  - business_ro.v_order_items
      (id, order_id, product_id, qty, unit_price, discount, line_total)
  - business_ro.v_returns
      (id, order_id, product_id, qty, reason, refund_amt, returned_at)
  - business_ro.v_support_tickets
      (id, customer_id, order_id, category, priority, status, created_at,
       resolved_at, satisfaction, resolution_hours)
  - business_ro.v_employees
      (id, department, title, level, region_id, region_name, manager_id,
       hired_at, is_active)
  - business_ro.v_revenue_daily
      (revenue_date, region_id, region_name, orders, units, gross_revenue,
       refunds, net_revenue)
  - business_ro.v_revenue_monthly
      (revenue_month, region_id, region_name, orders, units, gross_revenue,
       refunds, net_revenue)
  - business_ro.v_product_performance
      (product_id, sku, name, category, units_sold, gross_revenue,
       returned_qty, refunds, return_rate_pct)"""


@dataclass
class GenerationResult:
    type: str  # "sql" | "clarification"
    sql: str = ""
    clarification: str = ""
    raw_response: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0


async def generate_sql(
    question: str,
    *,
    llm: LLMClient,
    catalog_context: str = "",
    few_shot_examples: list[dict[str, str]] | None = None,
    reference_date: date | str = "2026-09-30",
    temperature: float = 0.0,
    max_tokens: int = 900,
) -> GenerationResult:
    """Call the LLM and parse the structured JSON response."""

    system = _SYSTEM_PROMPT.format(
        reference_date=str(reference_date),
        view_list=_VIEW_LIST,
    )
    if catalog_context:
        system += (
            "\n\nSCHEMA NOTES (admin-maintained descriptions; use these relationships):\n"
            f"{catalog_context}"
        )

    messages: list[dict[str, str]] = []
    for example in few_shot_examples or []:
        messages.append({"role": "user", "content": example["question"]})
        messages.append(
            {
                "role": "assistant",
                "content": json.dumps({"type": "sql", "sql": example["sql"].strip()}),
            }
        )
    messages.append({"role": "user", "content": question})

    raw = ""
    prompt_tokens = 0
    completion_tokens = 0
    try:
        async for delta in llm.stream(
            system=system,
            messages=messages,
            temperature=temperature,
            max_output_tokens=max_tokens,
        ):
            if delta.text:
                raw += delta.text
            if delta.prompt_tokens is not None:
                prompt_tokens = delta.prompt_tokens
            if delta.completion_tokens is not None:
                completion_tokens = delta.completion_tokens
    except LLMError as exc:
        raise LLMError(f"SQL generation LLM call failed: {exc}") from exc

    parsed = _parse_response(raw.strip())
    parsed.prompt_tokens = prompt_tokens
    parsed.completion_tokens = completion_tokens
    return parsed


def _parse_response(raw: str) -> GenerationResult:
    """Extract and validate the JSON payload from the model response."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(0)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("sql_generator could not parse LLM response: %.200s", raw)
        return GenerationResult(
            type="clarification",
            clarification="I couldn't formulate a query for that question. Could you rephrase it?",
            raw_response=raw,
        )

    if not isinstance(data, dict):
        return GenerationResult(
            type="clarification",
            clarification="I couldn't determine how to answer that. Could you rephrase?",
            raw_response=raw,
        )

    kind = str(data.get("type", ""))
    if kind == "sql":
        sql = str(data.get("sql", "")).strip()
        if not sql:
            return GenerationResult(
                type="clarification",
                clarification="I wasn't sure what SQL to generate. Could you give more details?",
                raw_response=raw,
            )
        return GenerationResult(type="sql", sql=sql, raw_response=raw)

    if kind == "clarification":
        clarification = str(data.get("clarification", "")).strip()
        return GenerationResult(
            type="clarification",
            clarification=clarification or "Could you clarify what data you're looking for?",
            raw_response=raw,
        )

    logger.warning("sql_generator unexpected type=%r", kind)
    return GenerationResult(
        type="clarification",
        clarification="I couldn't determine how to answer that. Could you rephrase?",
        raw_response=raw,
    )
