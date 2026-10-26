"""Database-backed access-filter tests.

These are opt-in because they create and drop a disposable PostgreSQL database.
Run them with an admin URL that can create databases:

    VERITY_TEST_ADMIN_URL=postgresql:///postgres \\
        services/ai/.venv/bin/python -m pytest -m integration

The test intentionally uses keyword retrieval only (``embedding=None``) so it
does not require the pgvector extension. It still exercises the real SQL access
predicate against ``app.documents``, ``app.document_groups`` and
``app.user_groups``.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest
from app.core.config import Settings
from app.rag.retrieval import PostgresRetrievalStore
from app.rag.types import AccessContext, Role
from psycopg import sql

ADMIN_URL = os.environ.get("VERITY_TEST_ADMIN_URL", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not ADMIN_URL,
        reason="VERITY_TEST_ADMIN_URL is not set",
    ),
]

SCHEMA_STATEMENTS = (
    "CREATE SCHEMA app",
    "CREATE TABLE app.users (id uuid PRIMARY KEY)",
    "CREATE TABLE app.groups (id uuid PRIMARY KEY)",
    """CREATE TABLE app.user_groups (
         user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
         group_id uuid NOT NULL REFERENCES app.groups(id) ON DELETE CASCADE,
         PRIMARY KEY (user_id, group_id)
       )""",
    """CREATE TABLE app.documents (
         id uuid PRIMARY KEY,
         title text NOT NULL,
         access_level text NOT NULL,
         status text NOT NULL
       )""",
    """CREATE TABLE app.document_groups (
         document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
         group_id uuid NOT NULL REFERENCES app.groups(id) ON DELETE CASCADE,
         PRIMARY KEY (document_id, group_id)
       )""",
    """CREATE TABLE app.chunks (
         id uuid PRIMARY KEY,
         document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
         chunk_index integer NOT NULL DEFAULT 0,
         content text NOT NULL,
         page_number integer,
         section text,
         tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
       )""",
    "CREATE INDEX idx_test_chunks_tsv ON app.chunks USING gin(tsv)",
)


@dataclass(frozen=True)
class SeededDatabase:
    url: str
    user_ids: dict[str, uuid.UUID]


def _database_url(admin_url: str, database: str) -> str:
    parts = urlsplit(admin_url)
    query = f"?{parts.query}" if parts.query else ""
    # urlunsplit drops the empty authority in ``postgresql:///db``, so build the
    # URL explicitly to keep the triple slash for local socket connections.
    return f"{parts.scheme}://{parts.netloc}/{database}{query}"


async def _seed(connection: psycopg.AsyncConnection[Any]) -> dict[str, uuid.UUID]:
    user_ids = {
        "admin": uuid.uuid4(),
        "analyst_finance": uuid.uuid4(),
        "analyst_exec": uuid.uuid4(),
        "viewer_plain": uuid.uuid4(),
        "viewer_finance": uuid.uuid4(),
    }
    group_ids = {"finance": uuid.uuid4(), "exec": uuid.uuid4()}
    document_ids = {
        "public": uuid.uuid4(),
        "internal": uuid.uuid4(),
        "restricted_finance": uuid.uuid4(),
        "restricted_exec": uuid.uuid4(),
    }

    documents = {
        "public": ("Public Handbook", "public", "The public vacation policy is 20 days."),
        "internal": ("Internal Memo", "internal", "The internal vacation policy is 22 days."),
        "restricted_finance": (
            "Finance Restricted",
            "restricted",
            "The finance vacation policy is 25 days.",
        ),
        "restricted_exec": (
            "Exec Restricted",
            "restricted",
            "The executive vacation policy is 30 days.",
        ),
    }
    memberships = {
        "analyst_finance": "finance",
        "analyst_exec": "exec",
        "viewer_finance": "finance",
    }
    document_groups = {
        "restricted_finance": "finance",
        "restricted_exec": "exec",
    }

    async with connection.cursor() as cursor:
        for statement in SCHEMA_STATEMENTS:
            await cursor.execute(statement)

        for user_id in user_ids.values():
            await cursor.execute("INSERT INTO app.users (id) VALUES (%s)", [user_id])
        for group_id in group_ids.values():
            await cursor.execute("INSERT INTO app.groups (id) VALUES (%s)", [group_id])

        for key, (title, access_level, content) in documents.items():
            document_id = document_ids[key]
            await cursor.execute(
                """INSERT INTO app.documents (id, title, access_level, status)
                   VALUES (%s, %s, %s, 'ready')""",
                [document_id, title, access_level],
            )
            await cursor.execute(
                """INSERT INTO app.chunks (id, document_id, chunk_index, content)
                   VALUES (%s, %s, 0, %s)""",
                [uuid.uuid4(), document_id, content],
            )

        for user_key, group_key in memberships.items():
            await cursor.execute(
                "INSERT INTO app.user_groups (user_id, group_id) VALUES (%s, %s)",
                [user_ids[user_key], group_ids[group_key]],
            )
        for document_key, group_key in document_groups.items():
            await cursor.execute(
                "INSERT INTO app.document_groups (document_id, group_id) VALUES (%s, %s)",
                [document_ids[document_key], group_ids[group_key]],
            )

    return user_ids


@pytest.fixture
async def seeded_database() -> AsyncIterator[SeededDatabase]:
    database_name = f"verity_test_{uuid.uuid4().hex[:12]}"
    admin = await psycopg.AsyncConnection.connect(ADMIN_URL, autocommit=True)
    try:
        async with admin.cursor() as cursor:
            await cursor.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
            )

        test_url = _database_url(ADMIN_URL, database_name)
        async with await psycopg.AsyncConnection.connect(test_url) as connection:
            user_ids = await _seed(connection)

        yield SeededDatabase(url=test_url, user_ids=user_ids)
    finally:
        async with admin.cursor() as cursor:
            await cursor.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                    sql.Identifier(database_name)
                )
            )
        await admin.close()


async def _titles_for(
    store: PostgresRetrievalStore,
    user_id: uuid.UUID,
    role: Role,
) -> set[str]:
    _, keyword_results = await store.search(
        question="vacation policy",
        embedding=None,
        access=AccessContext(user_id=str(user_id), role=role),
        limit=50,
    )
    return {chunk.title for chunk in keyword_results}


@pytest.mark.asyncio
async def test_access_filter_prevents_cross_role_leakage(
    settings: Settings,
    seeded_database: SeededDatabase,
) -> None:
    store = PostgresRetrievalStore(settings, database_url=seeded_database.url)
    users = seeded_database.user_ids

    assert await _titles_for(store, users["viewer_plain"], "viewer") == {"Public Handbook"}
    assert await _titles_for(store, users["viewer_finance"], "viewer") == {
        "Public Handbook",
        "Finance Restricted",
    }
    assert await _titles_for(store, users["analyst_finance"], "analyst") == {
        "Public Handbook",
        "Internal Memo",
        "Finance Restricted",
    }
    assert await _titles_for(store, users["analyst_exec"], "analyst") == {
        "Public Handbook",
        "Internal Memo",
        "Exec Restricted",
    }
    assert await _titles_for(store, users["admin"], "admin") == {
        "Public Handbook",
        "Internal Memo",
        "Finance Restricted",
        "Exec Restricted",
    }
