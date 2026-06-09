#!/usr/bin/env python3
"""
Lint: an explanation must not reference an answer by its display letter.

Options are shuffled per session, so a literal "(C)", "answer B", or "Graph E"
in an explanation can desync from what the student sees. Allowed exceptions:
  - The letter sits inside a math span \(...\), \[...\], or $...$ (e.g. P(D),
    \ker(B) are math, not answer references).
  - The question is a letter-keyed figure: it has an image and >=3 of its
    options are positional labels ("(A)".."(E)" or "Graph A".."Graph E").
    Those are exempt from shuffle by the render guard, so letter refs are fine.

Run from repo root. Exit non-zero on any violation.
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "questions.json")

MATH_SPAN = re.compile(r'\\\(.*?\\\)|\\\[.*?\\\]|\$.*?\$', re.S)
REF = re.compile(r'\(([A-E])\)|\b(?:answer|choice|option|graph)s?\s*\(?([A-E])\b', re.I)
LBL = "ABCDE"

def is_letter_keyed_figure(q):
    if not q.get("image"):
        return False
    opts = q.get("options", [])
    n = 0
    for k, o in enumerate(opts[:5]):
        if re.match(r'^\s*(?:graph|figure|option|choice)?\s*[(]?' + LBL[k] + r'[).:]?(\s|$)', o, re.I):
            n += 1
    return n >= 3

def main():
    data = json.load(open(BANK, encoding="utf-8"))
    violations = []
    for q in data:
        exp = q.get("explanation") or ""
        if is_letter_keyed_figure(q):
            continue
        stripped = MATH_SPAN.sub(" ", exp)
        m = REF.search(stripped)
        if m:
            violations.append((q["id"], m.group(0), stripped[max(0, m.start()-25):m.start()+25].strip()))
    if violations:
        print("FAIL: %d explanation(s) reference an answer by letter (breaks under shuffle):" % len(violations))
        for qid, tok, ctx in violations:
            print("  %-14s near %r  ...%s..." % (qid, tok, ctx))
        return 1
    print("OK: no explanation references an answer by display letter (%d questions)" % len(data))
    return 0

if __name__ == "__main__":
    sys.exit(main())
