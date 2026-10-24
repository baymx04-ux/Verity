"""Inline citation parsing and streaming-safe validation."""

from __future__ import annotations

import re

_CITATION_RE = re.compile(r"\[(\d{1,3})\]")


def extract_citation_indices(text: str) -> list[int]:
    return sorted({int(match.group(1)) for match in _CITATION_RE.finditer(text)})


def validate_citations(text: str, citation_count: int) -> tuple[str, list[int]]:
    """Remove markers that do not map to a retrieved source.

    The model is instructed to cite only ``[1]`` through ``[N]``. Hallucinated
    markers are removed before persistence and before the browser sees them.
    """

    cited: set[int] = set()

    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        if 1 <= index <= citation_count:
            cited.add(index)
            return match.group(0)
        return ""

    cleaned = _CITATION_RE.sub(replace, text)
    return cleaned, sorted(cited)


class CitationStreamFilter:
    """Buffers only potential citation markers while tokens are streaming.

    Invalid markers are dropped, valid markers are emitted unchanged, and plain
    bracketed prose is preserved. This lets the gateway persist exactly the text
    the browser saw.
    """

    def __init__(self, citation_count: int) -> None:
        self._citation_count = max(0, citation_count)
        self._buffer = ""
        self.cited: set[int] = set()

    def feed(self, text: str) -> str:
        self._buffer += text
        output: list[str] = []

        while self._buffer:
            start = self._buffer.find("[")
            if start == -1:
                output.append(self._buffer)
                self._buffer = ""
                break
            if start > 0:
                output.append(self._buffer[:start])
                self._buffer = self._buffer[start:]

            close = self._buffer.find("]")
            if close == -1:
                inner = self._buffer[1:]
                if inner == "" or (inner.isdigit() and len(inner) <= 3):
                    break
                output.append("[")
                self._buffer = self._buffer[1:]
                continue

            candidate = self._buffer[: close + 1]
            if _CITATION_RE.fullmatch(candidate):
                index = int(candidate[1:-1])
                if 1 <= index <= self._citation_count:
                    self.cited.add(index)
                    output.append(candidate)
                self._buffer = self._buffer[close + 1 :]
                continue

            output.append("[")
            self._buffer = self._buffer[1:]

        return "".join(output)

    def flush(self) -> str:
        remaining = self._buffer
        self._buffer = ""
        match = _CITATION_RE.fullmatch(remaining)
        if not match:
            return remaining
        index = int(match.group(1))
        if 1 <= index <= self._citation_count:
            self.cited.add(index)
            return remaining
        return ""
