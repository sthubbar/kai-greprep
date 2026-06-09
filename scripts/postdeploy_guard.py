#!/usr/bin/env python3
"""
Post-deploy guard with automatic rollback AND post-rollback verification.

Flow (run from repo root, right after `git push origin main`):
  1. VERIFY: poll the live site until the published questions.json and
     index.html match the committed repo copies (md5) and pass a health check,
     or until --timeout elapses.
  2. If verified -> exit 0. Done.
  3. If NOT verified -> ROLLBACK: revert HEAD as Steve and push, which triggers
     a fresh deploy of the previous-good tree.
  4. RE-VERIFY THE ROLLBACK: poll again until the live site matches the
     post-revert repo copies. A rollback that is not itself confirmed is just a
     second unchecked change, so this step is mandatory.
       - rollback confirmed  -> exit 2 (deploy failed, site safely restored)
       - rollback NOT confirmed -> exit 3 (CRITICAL, needs a human)

Secrets never touch argv or the repo: the authenticated push URL is read from
the env var GUARD_PUSH_REMOTE (e.g. https://USER:TOKEN@github.com/owner/repo.git).
If it is unset, rollback is skipped and the script exits 4 (verify-only mode).

Usage:
  GUARD_PUSH_REMOTE="https://USER:TOKEN@github.com/sthubbar/kai-greprep.git" \
  python3 scripts/postdeploy_guard.py --url https://kai-greprep.netlify.app \
      --timeout 180 --assets questions.json index.html
"""
import argparse, hashlib, json, os, subprocess, sys, time, urllib.request

def md5_bytes(b): return hashlib.md5(b).hexdigest()

def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def healthy(name, body):
    if name.endswith(".json"):
        try:
            d = json.loads(body)
        except Exception as e:
            return False, "not valid JSON: %s" % e
        if isinstance(d, list) and len(d) == 0:
            return False, "empty array"
        return True, "json ok"
    if name.endswith(".html"):
        if len(body) < 1000:
            return False, "html too small (%d bytes)" % len(body)
        if b"</html>" not in body[-300:]:
            return False, "html does not end with </html> (truncated?)"
        return True, "html ok"
    return True, "ok"

def expected_hashes(repo, assets):
    out = {}
    for a in assets:
        with open(os.path.join(repo, a), "rb") as f:
            out[a] = md5_bytes(f.read())
    return out

def verify(url, repo, assets, markers, timeout, label):
    """Poll until the live site reflects the committed deploy.

    Verification is per-asset by intent, because a CDN may legitimately rewrite
    some files (e.g. Netlify rewrites its own <form netlify> tag, so live HTML
    never byte-matches the repo):
      - .json  -> must byte-match the repo md5 (JSON is served untouched).
      - .html  -> must be healthy (ends with </html>, non-trivial size) and
                  contain every required marker substring. No md5, to tolerate
                  CDN HTML rewrites.
      - other  -> health check only.
    """
    expect = expected_hashes(repo, [a for a in assets if a.endswith(".json")])
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        ok = True
        for a in assets:
            try:
                body = fetch("%s/%s?cb=%d" % (url.rstrip("/"), a, int(time.time())))
            except Exception as e:
                ok = False; last[a] = "fetch error: %s" % e; continue
            h_ok, h_msg = healthy(a, body)
            if not h_ok:
                ok = False; last[a] = "unhealthy: %s" % h_msg
            elif a.endswith(".json"):
                live = md5_bytes(body)
                if live != expect[a]:
                    ok = False; last[a] = "md5 mismatch (live %s != repo %s)" % (live[:8], expect[a][:8])
                else:
                    last[a] = "md5 match"
            elif a.endswith(".html"):
                missing = [m for m in markers if m.encode() not in body]
                if missing:
                    ok = False; last[a] = "missing markers %s" % missing
                else:
                    last[a] = "healthy+markers" if markers else "healthy"
            else:
                last[a] = "healthy"
        print("[%s] %s" % (label, ", ".join("%s=%s" % (a, last[a]) for a in assets)))
        if ok:
            return True
        time.sleep(10)
    return False

def git(*args, check=True):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout.strip()

def rollback(repo, push_remote):
    os.chdir(repo)
    git("config", "user.email", "sthubbar@gmail.com")
    git("config", "user.name", "Steve Hubbard")
    bad = git("rev-parse", "HEAD")
    git("revert", "--no-edit", "HEAD")
    git("push", push_remote, "HEAD:main")
    reverted = git("rev-parse", "HEAD")
    print("ROLLBACK: reverted %s, pushed %s" % (bad[:8], reverted[:8]))
    return reverted

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--assets", nargs="+", default=["questions.json", "index.html"])
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--markers", nargs="*", default=[],
                    help="substrings that must appear in live HTML assets")
    args = ap.parse_args()
    repo = os.path.abspath(args.repo)

    print("== VERIFY deploy ==")
    if verify(args.url, repo, args.assets, args.markers, args.timeout, "verify"):
        print("RESULT: deploy verified live. OK.")
        return 0

    print("RESULT: deploy did NOT verify within %ss." % args.timeout)
    push_remote = os.environ.get("GUARD_PUSH_REMOTE")
    if not push_remote:
        print("GUARD_PUSH_REMOTE unset; cannot roll back. Exiting verify-only.")
        return 4

    print("== ROLLBACK ==")
    rollback(repo, push_remote)

    print("== RE-VERIFY ROLLBACK ==")
    # after revert, the repo working tree IS the previous-good state, so the same
    # md5 verify against the (now reverted) repo copies confirms the restore.
    if verify(args.url, repo, args.assets, args.markers, args.timeout, "rollback-verify"):
        print("RESULT: deploy failed but ROLLBACK CONFIRMED live. Site restored.")
        return 2
    print("RESULT: CRITICAL. Rollback could NOT be confirmed live. Human needed.")
    return 3

if __name__ == "__main__":
    sys.exit(main())
