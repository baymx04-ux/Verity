from app.rag.citations import CitationStreamFilter, extract_citation_indices, validate_citations


def test_extract_citation_indices() -> None:
    text = "Here is some information [1] and another detail [3] with [1] repeated."
    indices = extract_citation_indices(text)
    assert indices == [1, 3]


def test_validate_citations_strips_hallucinations() -> None:
    text = "Fact from [1] and another from [5] and valid [2]."
    cleaned, cited = validate_citations(text, citation_count=2)
    assert cleaned == "Fact from [1] and another from  and valid [2]."
    assert cited == [1, 2]


def test_citation_stream_filter_buffers_and_filters() -> None:
    flt = CitationStreamFilter(citation_count=2)

    # Feeding in split tokens: "[", "1", "]"
    out1 = flt.feed("According to ")
    assert out1 == "According to "
    out2 = flt.feed("[")
    assert out2 == ""
    out3 = flt.feed("1")
    assert out3 == ""
    out4 = flt.feed("], employees get 25 days. Also see [")
    assert out4 == "[1], employees get 25 days. Also see "
    out5 = flt.feed("99")
    assert out5 == ""
    out6 = flt.feed("] for details.")
    # 99 is invalid, so it should be stripped
    assert out6 == " for details."
    tail = flt.flush()
    assert tail == ""
    assert flt.cited == {1}
    assert flt.dropped_indices == {99}
    assert flt.dropped_count == 1


def test_citation_stream_filter_tracks_dropped_markers() -> None:
    flt = CitationStreamFilter(citation_count=2)
    assert flt.feed("Bad [9] and [0].") == "Bad  and ."
    assert flt.dropped_indices == {0, 9}
    assert flt.dropped_count == 2

    # An incomplete marker at the end of the stream is preserved as prose, not
    # counted as a citation.
    trailing = CitationStreamFilter(citation_count=2)
    assert trailing.feed("tail [7") == "tail "
    assert trailing.flush() == "[7"
    assert trailing.dropped_indices == set()
    assert trailing.dropped_count == 0


def test_citation_stream_filter_handles_plain_brackets() -> None:
    flt = CitationStreamFilter(citation_count=2)
    out1 = flt.feed("Array index [i")
    assert out1 == "Array index [i"
    out2 = flt.feed("] or [key]")
    assert out2 == "] or [key]"
    assert flt.flush() == ""
