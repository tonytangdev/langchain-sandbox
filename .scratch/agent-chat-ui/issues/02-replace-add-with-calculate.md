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

**Status:** done

- [x] `npm run cli "what is 2^3^2"` answers 512
- [x] `npm run cli "what is -2^2"` answers -4
- [x] Expressions support `+ - * / ^`, parentheses, unary minus and decimal/exponent
      literals, and nothing else — no identifiers, no function calls, no property access
- [x] Empty or whitespace-only input returns an error string, never a result
- [x] A result that is not a finite number returns an error string naming the problem
- [x] A malformed expression returns an error string and the agent can try again in the
      same conversation
- [x] The tool description warns that integers beyond 2^53 are imprecise
- [~] `add` no longer exists anywhere in the repo — the Tool is gone, but `README.md` and
      `spike/one-shot-agent.ts` still mention it (see comment below)

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

---

Built as `src/domain/tools/calculate.ts`: a hand-written tokenizer plus recursive-descent
parser that evaluates as it parses, no dependency added. `src/domain/tools/add.ts` is
deleted and `src/main.ts` now passes `calculateTool`. Tool name `calculate`, one required
string argument `expression`.

The precedence table is `expression → term → unary → power → primary`, with `power`
recursing into `unary` on its right. That single arrangement produces both required
behaviours: `^` right-associative (`2^3^2` = 512) and unary minus looser than `^`
(`-2^2` = -4).

Deviations worth knowing:

- Whole numbers skip the 12-significant-digit rounding. Rounding `9007199254740992` to 12
  digits would replace correct digits with zeros, which is a worse lie than the float
  imprecision the description already warns about. Non-integers still round, so `0.1+0.2`
  prints `0.3`.
- Division by zero is caught at the operator rather than left to become `Infinity`, so the
  error names the step instead of only the symptom.
- A nesting cap of 64 levels exists because the parser recurses; without it, deep input
  would escape as a `RangeError` rather than as a sentence the Model can read.
- `add` is gone from `src/`, but `README.md` (the worked examples and the sample output
  block) and `spike/one-shot-agent.ts` still reference it. Both were outside this ticket's
  scope fence and are being edited concurrently by other tickets, so they were left alone —
  the README needs a follow-up pass.
