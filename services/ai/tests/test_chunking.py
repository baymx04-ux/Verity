from itertools import pairwise

from app.ingestion.chunking import chunk_pages, embedding_text, estimate_tokens, normalize_text
from app.ingestion.parsers import ParsedPage


def page(text: str, number: int | None = 1, section: str | None = None) -> ParsedPage:
    return ParsedPage(text=text, page_number=number, section=section)


def test_normalize_collapses_control_characters_and_blank_lines() -> None:
    raw = "Title\r\n\r\n\r\n  Body\u00a0text \x07 here  "
    assert normalize_text(raw) == "Title\n\nBody text here"


def test_chunks_respect_the_token_budget() -> None:
    pages = [page("\n\n".join([f"block {i} " + " ".join(["sentence"] * 40) for i in range(12)]))]

    chunks = chunk_pages(pages, target_tokens=200, overlap_tokens=40)

    assert len(chunks) > 1
    assert all(chunk.token_count <= 200 for chunk in chunks)


def test_overlap_repeats_context_between_neighbours() -> None:
    first = " ".join([f"Alpha{i} sentence." for i in range(80)])
    second = " ".join([f"Bravo{i} sentence." for i in range(80)])
    pages = [page(f"{first}\n\n{second}")]

    chunks = chunk_pages(pages, target_tokens=100, overlap_tokens=40)

    assert len(chunks) >= 2
    assert all(chunk.token_count <= 100 for chunk in chunks)

    # The tail of each chunk must be carried into the next chunk. Checking a
    # unique unit (not a repeated string) proves overlap actually happens.
    for previous, following in pairwise(chunks):
        tail = previous.content.split("\n\n")[-1]
        assert tail in following.content


def test_long_paragraph_is_split_without_empty_chunks() -> None:
    pages = [page("x" * 5000)]

    chunks = chunk_pages(pages, target_tokens=100, overlap_tokens=20)

    assert chunks
    assert all(chunk.content.strip() for chunk in chunks)
    # A single unbreakable word run is split by length, not by whitespace.
    assert all(len(chunk.content) <= 500 for chunk in chunks)
    assert chunks[0].content.startswith("x")
    assert len(chunks) >= 2


def test_page_numbers_and_sections_are_preserved() -> None:
    pages = [
        page(" ".join(["intro"] * 60), number=1, section="Overview"),
        page(" ".join(["detail"] * 60), number=2, section="Details"),
    ]

    chunks = chunk_pages(pages, target_tokens=100, overlap_tokens=0)

    assert {chunk.page_number for chunk in chunks} == {1, 2}
    assert {chunk.section for chunk in chunks} == {"Details", "Overview"}


def test_empty_input_produces_no_chunks() -> None:
    assert chunk_pages([page("   ")], target_tokens=100, overlap_tokens=10) == []


def test_embedding_text_prefixes_document_context() -> None:
    chunks = chunk_pages(
        [page(" ".join(["Hello"] * 80), section="Greeting")],
        target_tokens=100,
        overlap_tokens=10,
    )
    text = embedding_text("Policy.pdf", chunks[0])

    assert text.startswith("Document: Policy.pdf\nSection: Greeting\n\n")
    assert "Hello" in text.split("\n\n", 1)[1]


def test_token_estimate_scales_with_length() -> None:
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("a" * 400) == 100


def test_invalid_overlap_is_rejected() -> None:
    pages = [page("Some content")]

    try:
        chunk_pages(pages, target_tokens=100, overlap_tokens=100)
    except ValueError:
        return
    raise AssertionError("expected ValueError for overlap >= target_tokens")
