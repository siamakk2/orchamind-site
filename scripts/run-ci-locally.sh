#!/usr/bin/env bash
# Runs EXACTLY the steps in .github/workflows/validate-app.yml, in order, read
# from the file itself. A hand-picked local list left out the two tests that
# were failing, and CI was red for twelve pushes while "the full suite" was
# reported green. Local and CI must be the same list by construction.
cd "$(dirname "$0")/.."
fail=0
while IFS= read -r cmd; do
  if out=$(eval "$cmd" 2>&1); then echo "  PASS  $cmd"; else echo "  FAIL  $cmd"; echo "$out" | grep -E "✗|❌|•|Error" | head -8 | sed 's/^/          /'; fail=1; fi
done < <(grep -E '^\s+run: node scripts/' .github/workflows/validate-app.yml | sed 's/^\s*run: //')
[ $fail -eq 0 ] && echo "ALL CI STEPS PASS" || { echo "CI WOULD FAIL"; exit 1; }
