"""SQL generator — structured LLM call that produces a SQL query or clarification.

The LLM is asked to respond in a strict JSON format:
  {
    "type": "sql" | "clarification",
    "sql": "<query>",          // present when type == "sql"
    "clarification": "<text>"  // present when type == "clarification"
  }

The catalog context and few-shot examples are included in the system prompt.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.llm.base import LLMClient, LLMError

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a SQL expert for the Verity analytics platform.
Your only job is to translate a natural-language question into a safe PostgreSQL query
against the read-only business_ro schema, OR ask a clarifying question if the intent
is genuinely ambiguous.

RULES — follow every one exactly:
1. Only query these views:
{view_list}

2. Always respond with a single JSON object, nothing else:
   If you can write the SQL:
     {{"type": "sql", "sql": "<your SELECT query>"}}
   If the question is ambiguous or missing required info:
     {{"type": "clarification", "clarification": "<your question to the user>"}}

3. The SQL must:
   - Be a single SELECT or WITH … SELECT statement
   - Reference only the allowed views above, fully qualified (business_ro.v_*)
   - Include a LIMIT clause (max 200)
   - Not contain any DML, DDL, COPY, or function calls to pg_sleep, pg_read_file, etc.

4. Do NOT include markdown fences, explanations, or any text outside the JSON object.
"""

_VIEW_LIST = """\
  - business_ro.v_products        (id, sku, name, category, subcategory, unit_price, stock_qty, is_active, created_date)
  - business_ro.v_customers       (id, city, country, segment, acquired_at, is_active)
  - business_ro.v_orders          (id, customer_id, status, channel, subtotal, discount, tax, total, currency, ordered_at, shipped_at, delivered_at)
  - business_ro.v_order_items     (id, order_id, product_id, qty, unit_price, discount, line_total)
  - business_ro.v_returns         (id, order_id, product_id, qty, reason, refund_amt, returned_at)
  - business_ro.v_support_tickets (id, customer_id, order_id, category, priority, status, created_at, resolved_at, satisfaction, resolution_hours)
  - business_ro.v_employees       (id, department, title, level, hired_at, is_active)"""


@dataclass
class GenerationResult:
    type: str  # "sql" | "clarification"
    sql: str = ""
    clarification: str = ""
    raw_response: str = ""


async def generate_sql(
    question: str,
    *,
    llm: LLMClient,
    catalog_context: str = "",
    few_shot_examples: list[dict[str, str]] | None = None,
    temperature: float = 0.0,
    max_tokens: int = 800,
) -> GenerationResult:
    """Call the LLM and parse the structured JSON response."""

    system = _SYSTEM_PROMPT.format(view_list=_VIEW_LIST)
    if catalog_context:
        system += f"\n\nSCHEMA NOTES:\n{catalog_context}"

    messages: list[dict[str, Any]] = []

    # Prepend few-shot examples as user/assistant turns
    for example in (few_shot_examples or []):
        messages.append({"role": "user", "content": example["question"]})
        messages.append({
            "role": "assistant",
            "content": json.dumps({"type": "sql", "sql": example["sql"].strip()}),
        })

    messages.append({"role": "user", "content": question})

    try:
        raw = ""
        async for delta in llm.stream(
            system=system,
            messages=messages,
            temperature=temperature,
            max_output_tokens=max_tokens,
        ):
            if delta.text:
                raw += delta.text
    except LLMError as exc:
        raise LLMError(f"SQL generation LLM call failed: {exc}") from exc

    return _parse_response(raw.strip())


def _parse_response(raw: str) -> GenerationResult:
    """Extract the JSON payload from the LLM response."""
    # Strip any accidental markdown fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    # Try to find the first {...} block
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

    # Unknown type — treat as clarification
    logger.warning("sql_generator unexpected type=%r", kind)
    return GenerationResult(
        type="clarification",
        clarification="I couldn't determine how to answer that. Could you rephrase?",
        raw_response=raw,
    )
