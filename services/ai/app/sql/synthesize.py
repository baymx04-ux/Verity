"""SQL answer synthesizer — turns query results into a grounded prose answer.

The model is given only the bounded result preview and is explicitly told not to
invent numbers. A conservative numeric post-check records suspicious values in
metadata for review; it never silently rewrites the answer.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

from app.llm.base import LLMClient

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a data analyst assistant for Verity. You receive a user question, the
SQL that ran, and a bounded result preview.

Rules:
- Answer only from the provided result.
- State the key answer first, then a short supporting detail.
- If the result is empty, say that no matching rows were found.
- Use commas for thousands and round money to two decimals.
- Do not claim that data exists outside the preview or invent figures.
- Do not include the SQL unless the user explicitly asked for it.
- Keep the answer under 160 words.
"""

_USER_TEMPLATE = """\
Question: {question}

SQL executed:
```sql
{sql}
```

Result ({row_count} rows{truncation_note}):
{result_json}
"""


async def synthesize(
    *,
    question: str,
    sql: str,
    rows: list[dict[str, Any]],
    truncated: bool,
    llm: LLMClient,
    temperature: float = 0.1,
    max_tokens: int = 600,
) -> AsyncIterator[str]:
    """Stream prose answer tokens for the given SQL result."""
    preview_rows = rows[:20]
    result_json = json.dumps(preview_rows, indent=2, default=str)
    truncation_note = (
        f"; previewing {len(preview_rows)} of {len(rows)} displayed rows" if truncated else ""
    )
    user_content = _USER_TEMPLATE.format(
        question=question,
        sql=sql,
        row_count=len(rows),
        truncation_note=truncation_note,
        result_json=result_json,
    )

    async for delta in llm.stream(
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        temperature=temperature,
        max_output_tokens=max_tokens,
    ):
        if delta.text:
            yield delta.text


def numeric_post_check(answer: str, rows: list[dict[str, Any]]) -> dict[str, object]:
    """Return a transparent numeric-consistency result for the answer.

    Large numbers in prose are compared with every numeric cell in the result.
    Years and percentages are ignored to avoid false positives. A flagged
    answer is still shown; the metadata tells the UI/reviewer what happened.
    """
    data_numbers = extract_numbers(rows)
    if not data_numbers:
        return {"status": "skipped", "unmatched": []}

    answer_numbers = {
        float(match.replace(",", ""))
        for match in re.findall(r"\d[\d,]*\.?\d*", answer)
        if match
    }
    unmatched = sorted(
        number
        for number in answer_numbers
        if number >= 100
        and not 1900 <= number <= 2100
        and not any(
            abs(number - candidate) <= max(0.5, abs(candidate) * 0.05)
            for candidate in data_numbers
        )
    )
    if unmatched:
        logger.warning("sql_synthesize numeric check flagged values: %s", unmatched)
        return {"status": "flagged", "unmatched": unmatched[:10]}
    return {"status": "passed", "unmatched": []}


def extract_numbers(rows: list[dict[str, Any]]) -> set[float]:
    numbers: set[float] = set()
    for row in rows:
        for value in row.values():
            if isinstance(value, int | float) and not isinstance(value, bool):
                numbers.add(float(value))
    return numbers
