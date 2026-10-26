"""SQL answer synthesizer — generates a prose answer from query results.

Takes the validated SQL, its result rows, and the original question, and
streams a natural-language answer. Also performs a numeric post-check:
if the answer contains numbers that don't match the result data, it flags
the discrepancy to the trace rather than blocking the response (plan §8).
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
You are a data analyst assistant. You will be given:
1. A user question about business data.
2. A SQL query that was executed against the database.
3. The query result (as JSON rows).

Your task:
- Write a concise, accurate answer to the question based ONLY on the provided data.
- If the result is empty, say so clearly.
- Round numbers sensibly; use commas for thousands.
- Do NOT fabricate data not present in the result.
- Do NOT include the SQL in your answer unless the user asked for it.
- Keep the answer under 200 words.
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

    # Build a compact result preview (first 20 rows max for the synthesis prompt)
    preview_rows = rows[:20]
    result_json = json.dumps(preview_rows, indent=2, default=str)
    truncation_note = f"; showing first {len(preview_rows)} of {len(rows)}" if truncated else ""

    user_content = _USER_TEMPLATE.format(
        question=question,
        sql=sql,
        row_count=len(rows),
        truncation_note=truncation_note,
        result_json=result_json,
    )

    numeric_values = _extract_numbers_from_rows(rows)
    answer_parts: list[str] = []

    async for delta in llm.stream(
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        temperature=temperature,
        max_output_tokens=max_tokens,
    ):
        if delta.text:
            answer_parts.append(delta.text)
            yield delta.text

    answer = "".join(answer_parts)
    _numeric_post_check(answer, numeric_values)


def _extract_numbers_from_rows(rows: list[dict[str, Any]]) -> set[float]:
    nums: set[float] = set()
    for row in rows:
        for v in row.values():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                nums.add(float(v))
    return nums


def _numeric_post_check(answer: str, data_nums: set[float]) -> None:
    """Flag numbers in the answer that are suspiciously absent from the data."""
    if not data_nums:
        return

    # Extract numbers mentioned in the answer
    answer_nums = {float(m.replace(",", "")) for m in re.findall(r"[\d,]+\.?\d*", answer)}

    # Check if large numbers in the answer are completely absent from data
    suspicious = {
        n for n in answer_nums
        if n > 100 and not any(abs(n - d) / max(abs(d), 1) < 0.05 for d in data_nums)
    }
    if suspicious:
        logger.warning(
            "sql_synthesize numeric_post_check: answer contains numbers not in result data: %s",
            suspicious,
        )
