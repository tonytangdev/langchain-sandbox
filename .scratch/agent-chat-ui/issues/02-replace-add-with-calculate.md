# 02 — Replace `add` with `calculate`

**What to build:** A Tool that evaluates an arithmetic expression, replacing the
two-number `add` tool.

Asking the agent "what is 2^3^2" returns 512 — right-associative, not 64. Asking for
something malformed, empty, or undefined-in-arithmetic returns a readable error the
model can react to, rather than throwing out of the loop or handing back a string the
model will misread as an answer.

`add` is deleted. It existed as a control to prove the wiring; `calculate` proves the
same thing better, and keeping both leaves the Model choosing between two overlapping
arithmetic tools.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `npm run cli "what is 2^3^2"` answers 512
- [ ] `npm run cli "what is -2^2"` answers -4
- [ ] Expressions support `+ - * / ^`, parentheses, unary minus and decimal/exponent
      literals, and nothing else — no identifiers, no function calls, no property access
- [ ] Empty or whitespace-only input returns an error string, never a result
- [ ] A result that is not a finite number returns an error string naming the problem
- [ ] A malformed expression returns an error string and the agent can try again in the
      same conversation
- [ ] The tool description warns that integers beyond 2^53 are imprecise
- [ ] `add` no longer exists anywhere in the repo

## Comments

Written by hand, no dependency. mathjs's own documentation says its sandbox is not
safe and April 2026 brought three sandbox-escape-to-RCE advisories including
CVE-2026-41139 ("no workarounds"); `expr-eval` is unmaintained with two unfixed CVEs,
one of which hit LangChain JS precisely because its `Calculator` was built on it. A
`new Function` + regex allowlist fails on correctness before it fails on security:
`^` is XOR in JavaScript, so `2^3` would silently return 1.

The security property here is structural rather than defensive — a grammar with no
identifiers and no calls has nothing to escape into.

Display rounding to 12 significant digits keeps `0.1+0.2` from surfacing as
`0.30000000000000004`. Avoid fixed decimal places, which corrupt very large and very
small magnitudes.

Since this repo has no tests, exercise the parser through the CLI before ticket 06
wires it to a UI — a wrong arithmetic answer looks exactly like a correct one.
