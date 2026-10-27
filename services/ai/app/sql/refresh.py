"""Refresh the text-to-SQL schema catalog from the command line.

Usage inside the AI container:

    python -m app.sql.refresh

The Make target ``make catalog-refresh`` runs this as a one-shot container.
"""

from __future__ import annotations

import asyncio
import logging
import sys

from app.core.config import get_settings
from app.ingestion.embeddings import GoogleEmbeddingClient
from app.sql.catalog import introspect_and_store


async def main() -> int:
    settings = get_settings()
    embeddings = GoogleEmbeddingClient(settings)
    count = await introspect_and_store(settings, embeddings)
    if count == 0:
        print(
            "No business_ro views were discovered. Run migrations and seed-business first.",
            file=sys.stderr,
        )
        return 1
    print(f"Catalog refreshed for {count} business_ro views.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    raise SystemExit(asyncio.run(main()))
