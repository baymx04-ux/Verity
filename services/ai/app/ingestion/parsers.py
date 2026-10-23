"""Parse the supported document formats into clean, page-aware text."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

from bs4 import BeautifulSoup
from docx import Document
from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {"pdf", "docx", "txt", "md", "markdown", "html", "htm"}

MIME_ALIASES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/x-markdown": "md",
    "text/html": "html",
    "application/xhtml+xml": "html",
}


class DocumentParseError(ValueError):
    """Raised when a file cannot be parsed into usable text."""


@dataclass(frozen=True, slots=True)
class ParsedPage:
    text: str
    page_number: int | None = None
    section: str | None = None


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    pages: tuple[ParsedPage, ...]
    page_count: int


def _extension(filename: str, mime_type: str | None) -> str:
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix:
        if suffix not in SUPPORTED_EXTENSIONS:
            raise DocumentParseError(
                "Unsupported file type. Supported types: PDF, DOCX, TXT, MD, HTML."
            )
        return "md" if suffix == "markdown" else "html" if suffix == "htm" else suffix

    mapped = MIME_ALIASES.get((mime_type or "").split(";")[0].strip().lower())
    if mapped:
        return mapped
    raise DocumentParseError(
        "Unsupported file type. Supported types: PDF, DOCX, TXT, MD, HTML."
    )


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DocumentParseError("The text file uses an unsupported character encoding.")


def _parse_pdf(data: bytes) -> ParsedDocument:
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = tuple(
            ParsedPage(
                text=page.extract_text() or "",
                page_number=index + 1,
            )
            for index, page in enumerate(reader.pages)
        )
    except Exception as exc:  # pypdf raises several unrelated exception types
        raise DocumentParseError("The PDF could not be read.") from exc

    if not any(page.text.strip() for page in pages):
        raise DocumentParseError(
            "The PDF contains no extractable text. Scanned PDFs need OCR, which is not enabled."
        )

    return ParsedDocument(pages=pages, page_count=len(pages))


def _parse_docx(data: bytes) -> ParsedDocument:
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:
        raise DocumentParseError("The DOCX file could not be read.") from exc

    pages: list[ParsedPage] = []
    section: str | None = None

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue

        style = (paragraph.style.name if paragraph.style is not None else "") or ""
        if style.lower().startswith("heading") or style.lower() == "title":
            section = text
            continue

        pages.append(ParsedPage(text=text, page_number=1, section=section))

    for table in document.tables:
        rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            pages.append(ParsedPage(text="\n".join(rows), page_number=1, section=section))

    if not pages:
        raise DocumentParseError("The DOCX file contains no readable text.")

    return ParsedDocument(pages=tuple(pages), page_count=1)


class _HTMLTextExtractor(HTMLParser):
    """Small fallback extractor used when BeautifulSoup has no body element."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())


def _parse_html(data: bytes) -> ParsedDocument:
    soup = BeautifulSoup(data, "html.parser")
    for tag in soup(["script", "style", "noscript", "template", "svg"]):
        tag.decompose()

    root = soup.body or soup
    pages: list[ParsedPage] = []
    section: str | None = None

    block_tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "blockquote", "pre"]
    for element in root.find_all(block_tags):
        text = re.sub(r"\s+", " ", element.get_text(" ", strip=True)).strip()
        if not text:
            continue
        if element.name and element.name.startswith("h"):
            section = text
            continue
        pages.append(ParsedPage(text=text, page_number=1, section=section))

    if not pages:
        extractor = _HTMLTextExtractor()
        extractor.feed(_decode_text(data))
        fallback = " ".join(extractor.parts).strip()
        if fallback:
            pages = [ParsedPage(text=fallback, page_number=1)]

    if not pages:
        raise DocumentParseError("The HTML file contains no readable text.")

    return ParsedDocument(pages=tuple(pages), page_count=1)


def _parse_markdown(data: bytes) -> ParsedDocument:
    text = _decode_text(data)
    pages: list[ParsedPage] = []
    section: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body:
            pages.append(ParsedPage(text=body, page_number=1, section=section))
        buffer.clear()

    for line in text.splitlines():
        heading = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if heading:
            flush()
            section = heading.group(2).strip()
            continue
        if line.strip().startswith(("```", "~~~")):
            buffer.append(line)
            continue
        buffer.append(re.sub(r"^\s*[-*+]\s+", "• ", line))

    flush()

    if not pages:
        raise DocumentParseError("The Markdown file contains no readable text.")

    return ParsedDocument(pages=tuple(pages), page_count=1)


def parse_document(filename: str, mime_type: str | None, data: bytes) -> ParsedDocument:
    """Parse a supported document. Raises :class:`DocumentParseError` on failure."""

    if not data:
        raise DocumentParseError("The uploaded file is empty.")

    extension = _extension(filename, mime_type)

    if extension == "pdf":
        return _parse_pdf(data)
    if extension == "docx":
        return _parse_docx(data)
    if extension == "html":
        return _parse_html(data)
    if extension == "md":
        return _parse_markdown(data)

    text = _decode_text(data)
    if not text.strip():
        raise DocumentParseError("The text file contains no readable text.")
    return ParsedDocument(pages=(ParsedPage(text=text, page_number=1),), page_count=1)
