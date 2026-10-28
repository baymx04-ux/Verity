#!/usr/bin/env python3
"""Measure automatic routing accuracy on ``evals/datasets/routing.jsonl``.

The harness calls the same classifier and confidence fallback used by the live
service, so the reported number reflects the route a user would actually get —
including questions that drop to hybrid below the threshold.

Usage:
    python evals/run_routing.py
    python evals/run_routing.py --threshold 0.7 --report evals/reports/routing.md

Requires a configured model key (for example ``GOOGLE_API_KEY`` in ``.env``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai"))

from app.core.config import Settings  # noqa: E402
from app.llm.factory import build_llm_client  # noqa: E402
from app.router.classifier import Route, classify_route  # noqa: E402

LABELS: tuple[Route, ...] = ("documents", "sql", "hybrid", "out_of_scope")


@dataclass(frozen=True, slots=True)
class Case:
    id: str
    question: str
    expected: Route
    history: list[dict[str, str]]


@dataclass(frozen=True, slots=True)
class Prediction:
    case: Case
    classified: Route
    confidence: float
    routed: Route
    fallback: bool
    available: bool
    reason: str


def load_cases(path: Path) -> list[Case]:
    cases: list[Case] = []
    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        payload = json.loads(line)
        expected = str(payload["route"]).strip().lower()
        if expected not in LABELS:
            raise SystemExit(f"{path}:{line_number}: unknown route {expected!r}")
        history = payload.get("history") or []
        cases.append(
            Case(
                id=str(payload["id"]),
                question=str(payload["question"]),
                expected=expected,  # type: ignore[arg-type]
                history=[
                    {"role": str(message["role"]), "content": str(message["content"])}
                    for message in history
                ],
            )
        )
    return cases


async def predict(
    case: Case,
    *,
    settings: Settings,
    llm: object,
    threshold: float,
    semaphore: asyncio.Semaphore,
) -> Prediction:
    async with semaphore:
        decision = await classify_route(
            case.question,
            history=case.history,
            llm=llm,  # type: ignore[arg-type]
            max_output_tokens=settings.router_max_output_tokens,
        )
    fallback = decision.confidence < threshold
    return Prediction(
        case=case,
        classified=decision.route,
        confidence=decision.confidence,
        routed="hybrid" if fallback else decision.route,
        fallback=fallback,
        available=decision.source == "model",
        reason=decision.reason,
    )


def build_report(predictions: list[Prediction], *, threshold: float, model: str) -> str:
    total = len(predictions)
    available = [item for item in predictions if item.available]
    unavailable_count = total - len(available)
    routed_correct = sum(1 for item in predictions if item.routed == item.case.expected)
    available_routed_correct = sum(
        1 for item in available if item.routed == item.case.expected
    )
    raw_correct = sum(1 for item in available if item.classified == item.case.expected)
    routed_accuracy = routed_correct / total if total else 0.0
    available_accuracy = available_routed_correct / len(available) if available else 0.0
    raw_accuracy = raw_correct / len(available) if available else 0.0
    fallback_count = sum(1 for item in available if item.fallback)

    pairs = Counter((item.case.expected, item.routed) for item in predictions)
    mismatches = [item for item in predictions if item.routed != item.case.expected]

    lines = [
        "# Routing accuracy",
        "",
        f"- Generated: {datetime.now(UTC).isoformat(timespec='seconds')}",
        f"- Model: `{model}`",
        f"- Confidence threshold: `{threshold}`",
        f"- Cases: **{total}**",
        f"- Classifier available: **{len(available)}/{total}**"
        + (
            f" ({unavailable_count} calls failed; the report is incomplete)"
            if unavailable_count
            else ""
        ),
        f"- Routed accuracy, all cases: **{routed_accuracy:.1%}** "
        f"({routed_correct}/{total})",
        f"- Routed accuracy, classifier-available cases: **{available_accuracy:.1%}** "
        f"({available_routed_correct}/{len(available)})",
        f"- Raw classifier accuracy, available cases: **{raw_accuracy:.1%}** "
        f"({raw_correct}/{len(available)})",
        f"- Below-threshold fallbacks to hybrid: **{fallback_count}**",
        "",
        "## Confusion matrix",
        "",
        "| expected \\ routed | documents | sql | hybrid | out_of_scope |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for expected in LABELS:
        cells = [str(pairs.get((expected, routed), 0)) for routed in LABELS]
        lines.append(f"| {expected} | " + " | ".join(cells) + " |")

    lines.extend(["", "## Mismatches", ""])
    if not mismatches:
        lines.append("None.")
    else:
        lines.append(
            "| id | question | expected | classified | confidence | routed | source | reason |"
        )
        lines.append("| --- | --- | --- | --- | ---: | --- | --- | --- |")
        for item in mismatches:
            question = item.case.question.replace("|", "\\|")
            reason = item.reason.replace("|", "\\|")
            source = "model" if item.available else "fallback"
            lines.append(
                f"| {item.case.id} | {question} | {item.case.expected} | "
                f"{item.classified} | {item.confidence:.2f} | {item.routed} | "
                f"{source} | {reason} |"
            )

    lines.append("")
    return "\n".join(lines)


async def run(args: argparse.Namespace) -> int:
    dataset = Path(args.dataset)
    if not dataset.is_absolute():
        dataset = ROOT / dataset
    cases = load_cases(dataset)
    if not cases:
        raise SystemExit(f"No cases found in {dataset}")

    settings = Settings(
        _env_file=str(ROOT / ".env"),
        router_confidence_threshold=args.threshold,
    )
    model = args.model or settings.router_model or settings.llm_model
    llm_settings = settings.model_copy(update={"llm_model": model})
    llm = build_llm_client(llm_settings)

    semaphore = asyncio.Semaphore(max(1, args.concurrency))
    predictions = await asyncio.gather(
        *(
            predict(
                case,
                settings=settings,
                llm=llm,
                threshold=args.threshold,
                semaphore=semaphore,
            )
            for case in cases
        )
    )

    report = build_report(predictions, threshold=args.threshold, model=model)
    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = ROOT / report_path
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")

    total = len(predictions)
    available = [item for item in predictions if item.available]
    correct = sum(1 for item in predictions if item.routed == item.case.expected)
    accuracy = correct / total
    print(f"Routing accuracy: {accuracy:.1%} ({correct}/{total}) on {total} cases")
    print(f"Report: {report_path}")
    if len(available) < total:
        print(
            f"Incomplete measurement: {total - len(available)} classifier calls failed. "
            "The accuracy above is not a valid routing measurement; rerun when the "
            "model quota/network is available."
        )
        return 2

    for item in predictions:
        if item.routed != item.case.expected:
            print(
                f"  miss {item.case.id}: expected={item.case.expected} "
                f"classified={item.classified} routed={item.routed} "
                f"confidence={item.confidence:.2f}"
            )

    return 0 if accuracy >= args.target else 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset",
        default="evals/datasets/routing.jsonl",
        help="Path to the JSONL routing dataset (default: evals/datasets/routing.jsonl)",
    )
    parser.add_argument(
        "--report",
        default="evals/reports/routing.md",
        help="Markdown report destination (default: evals/reports/routing.md)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.7,
        help="Confidence threshold below which the route falls back to hybrid",
    )
    parser.add_argument("--target", type=float, default=0.9, help="Required accuracy")
    parser.add_argument("--model", default="", help="Override the router model id")
    parser.add_argument(
        "--concurrency", type=int, default=4, help="Parallel classifier calls"
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
