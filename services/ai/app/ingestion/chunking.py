"""Structure-aware, token-bounded chunking for ingestion."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from app.ingestion.parsers import ParsedPage

_CONTROL_CHARS = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]")
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
_PARAGRAPH_BOUNDARY = re.compile(r"\n\s*\n")
_WHITESPACE = re.compile(r"[ \t\f\v]+")


def estimate_tokens(text: str) -> int:
    """Fast, deterministic approximation used for chunk sizing.

    We deliberately avoid downloading a tokenizer at ingest time. Four
    characters per token is close enough for the configured chunk bounds, and
    the embedding model still enforces its own hard context limit.
    """

    return max(1, math.ceil(len(text) / 4))


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = _CONTROL_CHARS.sub("", text)
    lines = [_WHITESPACE.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@dataclass(frozen=True, slots=True)
class ChunkDraft:
    content: str
    page_number: int | None
    section: str | None
    token_count: int


@dataclass(frozen=True, slots=True)
class _Unit:
    text: str
    page_number: int | None
    section: str | None

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


def _split_long_text(text: str, target_tokens: int) -> list[str]:
    words = text.split()
    if not words:
        return []

    pieces: list[str] = []
    current: list[str] = []
    current_chars = 0
    max_chars = max(1, target_tokens * 4)

    for word in words:
        addition = len(word) + (1 if current else 0)
        if current and current_chars + addition > max_chars:
            pieces.append(" ".join(current))
            current = [word]
            current_chars = len(word)
        else:
            current.append(word)
            current_chars += addition

    if current:
        pieces.append(" ".join(current))
    return pieces


def _hard_split(text: str, target_tokens: int) -> list[str]:
    """Split a single unbreakable token run (no whitespace) by length."""

    max_chars = max(1, target_tokens * 4)
    return [text[index : index + max_chars] for index in range(0, len(text), max_chars)]


def _page_units(page: ParsedPage, target_tokens: int) -> list[_Unit]:
    text = normalize_text(page.text)
    if not text:
        return []

    units: list[_Unit] = []
    paragraphs = [part.strip() for part in _PARAGRAPH_BOUNDARY.split(text) if part.strip()]

    for paragraph in paragraphs:
        if estimate_tokens(paragraph) <= target_tokens:
            units.append(_Unit(paragraph, page.page_number, page.section))
            continue

        sentences = [part.strip() for part in _SENTENCE_BOUNDARY.split(paragraph) if part.strip()]
        for sentence in sentences or [paragraph]:
            if estimate_tokens(sentence) <= target_tokens:
                units.append(_Unit(sentence, page.page_number, page.section))
                continue

            for piece in _split_long_text(sentence, target_tokens):
                if estimate_tokens(piece) <= target_tokens:
                    units.append(_Unit(piece, page.page_number, page.section))
                else:
                    # A single word longer than the budget (minified text,
                    # base64 blob, CJK run) is cut by length so it can never
                    # produce an unbounded chunk.
                    units.extend(
                        _Unit(chunk, page.page_number, page.section)
                        for chunk in _hard_split(piece, target_tokens)
                    )

    return units


def chunk_pages(
    pages: tuple[ParsedPage, ...] | list[ParsedPage],
    target_tokens: int = 650,
    overlap_tokens: int = 100,
) -> list[ChunkDraft]:
    """Pack parsed pages into overlapping chunks that never exceed the budget.

    Paragraphs are kept intact where possible; oversized paragraphs fall back to
    sentences, then to word runs. Overlap is taken from the tail of the previous
    chunk so retrieval has local context on both sides of a boundary.
    """

    if target_tokens < 50:
        raise ValueError("target_tokens must be at least 50")
    if overlap_tokens < 0 or overlap_tokens >= target_tokens:
        raise ValueError("overlap_tokens must be between 0 and target_tokens - 1")

    units: list[_Unit] = []
    for page in pages:
        units.extend(_page_units(page, target_tokens))

    if not units:
        return []

    groups: list[list[_Unit]] = []
    current: list[_Unit] = []
    current_chars = 0

    for unit in units:
        # Leave room for the overlap that will be prepended to this group. Without
        # this reservation a group is packed to `target_tokens`, leaving no space
        # for its predecessor's tail and silently disabling overlap.
        group_budget = target_tokens if not groups else max(1, target_tokens - overlap_tokens)

        sep = 2 if current else 0
        candidate_chars = current_chars + sep + len(unit.text)
        candidate_tokens = max(1, math.ceil(candidate_chars / 4))

        if current and candidate_tokens > group_budget:
            groups.append(current)
            current = []
            current_chars = 0

        sep2 = 2 if current else 0
        current.append(unit)
        current_chars += sep2 + len(unit.text)

        if estimate_tokens("\n\n".join(u.text for u in current)) >= group_budget:
            groups.append(current)
            current = []
            current_chars = 0

    if current:
        groups.append(current)

    chunks: list[ChunkDraft] = []
    for index, group in enumerate(groups):
        group_text = "\n\n".join(u.text for u in group)
        group_tokens = estimate_tokens(group_text)
        available = max(0, target_tokens - group_tokens)
        overlap = (
            _overlap_seed(groups[index - 1], overlap_tokens, group, available)
            if index > 0 and overlap_tokens > 0
            else []
        )
        combined = [*overlap, *group]

        # Trim overlap until we fit within the budget (separator overhead).
        while (
            overlap
            and estimate_tokens("\n\n".join(u.text for u in [*overlap, *group])) > target_tokens
        ):
            overlap = overlap[1:]
            combined = [*overlap, *group]

        if any(unit.text.strip() for unit in combined):
            chunks.append(_to_chunk(combined))

    deduped: list[ChunkDraft] = []
    for chunk in chunks:
        if deduped and chunk.content == deduped[-1].content:
            continue
        deduped.append(chunk)

    return [chunk for chunk in deduped if chunk.content.strip()]


def _to_chunk(units: list[_Unit]) -> ChunkDraft:
    content = "\n\n".join(unit.text for unit in units).strip()
    section = next((unit.section for unit in units if unit.section), None)
    return ChunkDraft(
        content=content,
        page_number=units[0].page_number if units else None,
        section=section,
        token_count=estimate_tokens(content),
    )


def _overlap_seed(
    previous: list[_Unit],
    overlap_tokens: int,
    upcoming: list[_Unit],
    available_tokens: int,
) -> list[_Unit]:
    """Tail of the previous group, skipping units already in the next group.

    The overlap is capped by both the configured overlap and the space left in
    the new chunk so a chunk can never exceed its token budget.
    """

    budget = min(overlap_tokens, available_tokens)
    if budget <= 0:
        return []

    upcoming_texts = {unit.text for unit in upcoming}
    seed: list[_Unit] = []
    total = 0
    for unit in reversed(previous):
        if unit.text in upcoming_texts:
            continue
        if total + unit.tokens > budget:
            break
        seed.insert(0, unit)
        total += unit.tokens
        if total >= budget:
            break
    return seed


def embedding_text(title: str, chunk: ChunkDraft) -> str:
    """Contextual text sent to the embedding model; the stored text stays raw."""

    context = [f"Document: {title}"]
    if chunk.section:
        context.append(f"Section: {chunk.section}")
    return "\n".join(context) + "\n\n" + chunk.content
