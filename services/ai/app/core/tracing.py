"""Backwards-compatible import for tracing primitives.

The implementation lives in :mod:`app.tracing` so exporters can be added without
expanding the core namespace.
"""

from app.tracing.base import Span, Trace

__all__ = ["Span", "Trace"]
