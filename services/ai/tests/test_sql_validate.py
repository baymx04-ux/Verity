import pytest
from app.sql.validate import validate


def test_allowed_select_gets_a_bounded_limit() -> None:
    result = validate("SELECT id, total FROM business_ro.v_orders")
    assert result.ok
    assert result.sql.endswith("LIMIT 201")
    assert result.checks["relation_allowlist"] is True


def test_qualified_allowed_view_is_accepted() -> None:
    result = validate(
        "SELECT o.id FROM business_ro.v_orders o "
        "JOIN business_ro.v_customers c ON c.id = o.customer_id LIMIT 10"
    )
    assert result.ok
    assert "v_customers" in result.sql


def test_unqualified_allowed_view_is_resolved() -> None:
    result = validate("SELECT * FROM v_orders LIMIT 5")
    assert result.ok


def test_cte_reference_is_not_treated_as_a_relation() -> None:
    result = validate(
        "WITH monthly AS (SELECT COUNT(*) AS n FROM business_ro.v_orders) "
        "SELECT n FROM monthly"
    )
    assert result.ok


@pytest.mark.parametrize(
    ("sql", "message"),
    [
        ("SELECT * FROM business.orders", "disallowed relations"),
        ("SELECT * FROM app.users", "disallowed relations"),
        ("SELECT * FROM business_ro.v_orders o, business_ro.v_customers c", "Cross join"),
        ("SELECT * FROM business_ro.v_orders; DROP TABLE business.orders", "exactly 1"),
        ("DELETE FROM business_ro.v_orders", "Only SELECT"),
        ("ALTER TABLE business.orders ADD COLUMN x int", "Only SELECT"),
        ("SELECT pg_sleep(10)", "denied functions"),
        ("SELECT * FROM pg_catalog.pg_class", "disallowed relations"),
    ],
)
def test_unsafe_queries_are_blocked(sql: str, message: str) -> None:
    result = validate(sql)
    assert not result.ok
    assert message in result.error


def test_explicit_limit_above_hard_cap_is_clamped() -> None:
    result = validate("SELECT * FROM business_ro.v_orders LIMIT 5000")
    assert result.ok
    assert result.sql.endswith("LIMIT 1000")


def test_nested_subquery_depth_is_bounded() -> None:
    sql = (
        "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM "
        "business_ro.v_orders) a) b) c) d"
    )
    result = validate(sql)
    assert not result.ok
    assert "Subquery depth" in result.error


def test_limit_is_injected_before_outer_order_by_clause_is_lost() -> None:
    result = validate(
        "SELECT status, COUNT(*) AS n FROM business_ro.v_orders "
        "GROUP BY status ORDER BY n DESC"
    )
    assert result.ok
    assert "ORDER BY n DESC" in result.sql
    assert "LIMIT 201" in result.sql


def test_values_only_query_is_rejected_as_a_query_answer() -> None:
    # VALUES is read-only but cannot answer a business question and should not
    # become a way to sidestep the SELECT allowlist.
    result = validate("VALUES (1)")
    assert not result.ok
    assert "Only SELECT" in result.error
