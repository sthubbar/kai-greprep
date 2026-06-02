#!/usr/bin/env python3
"""
Validate the question bank for the kai-greprep deploy.

Run from the repo root. Exits nonzero on any failure. CI calls this on every
push and PR; the daily ingestion task also calls it before committing.
"""

import json
import sys
from pathlib import Path

# Topic taxonomy currently in use. New tags must be added here AND reflected in
# the frontend topic-chip list. Curated 2026-05-31 from the live bank.
CANONICAL_TOPICS = {
    "calculus",
    "linear_algebra",
    "real_analysis",
    "geometry",
    "abstract_algebra",
    "probability",
    "algebra",
    "number_theory",
    "topology",
    "discrete_math",
    "complex_analysis",
    "differential_equations",
    "foundations_logic",
    "combinatorics",
    "logic",
    "algorithms_combinatorics",
    "precalculus_trig",
    "numerical_analysis",
    "set_theory",
    "statistics",
    "numerical_methods",
}

REQUIRED_FIELDS = {
    "id",
    "source",
    "topics",
    "difficulty",
    "stem",
    "options",
    "answer",
    "explanation",
    "image",
    "status",
    "version",
}

VALID_STATUSES = {"active", "deferred", "retired"}
VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def fail(errors):
    print(f"FAIL: {len(errors)} issue(s) found", file=sys.stderr)
    for e in errors[:50]:
        print(f"  - {e}", file=sys.stderr)
    if len(errors) > 50:
        print(f"  ... and {len(errors) - 50} more", file=sys.stderr)
    sys.exit(1)


def main():
    root = Path(__file__).resolve().parent.parent
    bank_path = root / "questions.json"

    if not bank_path.exists():
        fail([f"missing {bank_path}"])

    with open(bank_path) as f:
        try:
            bank = json.load(f)
        except json.JSONDecodeError as e:
            fail([f"questions.json failed to parse: {e}"])

    if not isinstance(bank, list):
        fail(["questions.json must be a JSON array"])

    if len(bank) < 330:
        fail([f"bank has {len(bank)} questions; expected >= 330"])

    errors = []
    seen_ids = set()

    for i, q in enumerate(bank):
        ctx = f"q[{i}] id={q.get('id', '?')}"

        # required fields
        missing = REQUIRED_FIELDS - set(q.keys())
        if missing:
            errors.append(f"{ctx}: missing fields: {sorted(missing)}")
            continue

        qid = q["id"]
        if qid in seen_ids:
            errors.append(f"{ctx}: duplicate id")
        seen_ids.add(qid)

        # types
        if not isinstance(q["stem"], str) or not q["stem"].strip():
            errors.append(f"{ctx}: stem must be a non-empty string")
        if not isinstance(q["explanation"], str) or not q["explanation"].strip():
            errors.append(f"{ctx}: explanation must be a non-empty string")

        # options
        opts = q["options"]
        if not isinstance(opts, list) or len(opts) != 5:
            errors.append(f"{ctx}: options must be a list of 5 strings")
        else:
            for j, o in enumerate(opts):
                if not isinstance(o, str) or not o.strip():
                    errors.append(f"{ctx}: option[{j}] must be a non-empty string")

        # answer
        ans = q["answer"]
        if not isinstance(ans, int) or not (0 <= ans <= 4):
            errors.append(f"{ctx}: answer must be int 0..4, got {ans!r}")

        # topics: must be list of canonical strings, non-empty
        topics = q["topics"]
        if not isinstance(topics, list) or not topics:
            errors.append(f"{ctx}: topics must be a non-empty list")
        else:
            non_canon = [t for t in topics if t not in CANONICAL_TOPICS]
            if non_canon:
                errors.append(f"{ctx}: non-canonical topics: {non_canon}")

        # status
        if q["status"] not in VALID_STATUSES:
            errors.append(f"{ctx}: status must be one of {VALID_STATUSES}, got {q['status']!r}")

        # difficulty
        if q["difficulty"] not in VALID_DIFFICULTIES:
            errors.append(f"{ctx}: difficulty must be one of {VALID_DIFFICULTIES}, got {q['difficulty']!r}")

        # version
        if not isinstance(q["version"], int) or q["version"] < 1:
            errors.append(f"{ctx}: version must be int >= 1")

        # image
        img = q["image"]
        if img:
            if not isinstance(img, str):
                errors.append(f"{ctx}: image must be a string or empty")
            else:
                rel = img if img.startswith("images/") else f"images/{img}"
                if not (root / rel).exists():
                    errors.append(f"{ctx}: image {rel} not found on disk")

    # em / en dash scan
    EM = "—"
    EN = "–"
    for q in bank:
        for field in ("stem", "explanation"):
            v = q.get(field, "")
            if isinstance(v, str) and (EM in v or EN in v):
                errors.append(f"q id={q.get('id')}: {field} contains em/en dash")
        for j, o in enumerate(q.get("options", [])):
            if isinstance(o, str) and (EM in o or EN in o):
                errors.append(f"q id={q.get('id')}: option[{j}] contains em/en dash")

    if errors:
        fail(errors)

    print(f"OK: {len(bank)} questions validated")


if __name__ == "__main__":
    main()
