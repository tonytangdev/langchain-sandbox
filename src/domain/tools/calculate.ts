import { z } from "zod";
import { defineTool } from "../types.js";

/**
 * Arithmetic the Model can trust, on a grammar with nothing to escape into.
 *
 * The obvious implementations are all worse. `new Function` is out on correctness before it
 * is out on security: `^` is XOR in JavaScript, so `2^3` would quietly return `1`. The
 * evaluator libraries are out on security: mathjs documents its own sandbox as unsafe and
 * `expr-eval` is unmaintained with unfixed sandbox-escape CVEs — one of which landed on
 * LangChain JS precisely because its `Calculator` was built on it.
 *
 * So the parser is written here, by hand, with no dependency. The safety property is
 * structural rather than defensive: the grammar below has no identifiers, no calls and no
 * property access, so there is no expression that reaches a JavaScript value at all. Adding
 * an identifier — even for something as harmless-looking as `pi` — would reintroduce the
 * whole class of escapes, so there is deliberately no escape hatch to extend.
 *
 * The grammar, in precedence order (loosest first):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?
 *   primary    := number | '(' expression ')'
 *
 * Two subtleties are the whole reason the table is written out. `power` recurses into
 * `unary` on its right, which makes `^` right-associative and makes `2^-3` legal, so
 * `2^3^2` is 512 and not 64. And `unary` sits *above* `power`, so a leading minus binds
 * looser than exponentiation and `-2^2` is -4, matching mathematical convention rather than
 * left-to-right reading.
 */

/**
 * Signals a bad expression. Private on purpose: every one of these is caught at the tool
 * boundary and returned as text, because a throw would end the run whereas a sentence the
 * Model can read lets it correct itself on the next turn.
 */
class ExpressionError extends Error {}

/**
 * Nesting cap. The parser recurses, so an input like 100k opening parentheses — or 100k
 * leading minus signs — would blow the stack and escape as a RangeError instead of as
 * something the Model could act on. Checked once in `unary`, which every recursive path
 * passes through.
 */
const MAX_DEPTH = 64;

/** Significant digits used when printing. See {@link format}. */
const SIGNIFICANT_DIGITS = 12;

type Token =
  | { readonly kind: "number"; readonly value: number; readonly at: number }
  | { readonly kind: "operator"; readonly value: string; readonly at: number };

/** Positions are reported 1-based, because the Model is quoting back a string a human wrote. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      i += 1;
      continue;
    }

    if ("+-*/^()".includes(char)) {
      tokens.push({ kind: "operator", value: char, at: i });
      i += 1;
      continue;
    }

    // A number literal: digits with an optional fraction and an optional exponent. `.5` is
    // accepted because models write it; `1e400` is accepted here and rejected later as a
    // non-finite *result*, which names the real problem better than "bad literal" would.
    if ((char >= "0" && char <= "9") || char === ".") {
      const start = i;
      while (i < input.length && input[i]! >= "0" && input[i]! <= "9") i += 1;
      if (input[i] === ".") {
        i += 1;
        while (i < input.length && input[i]! >= "0" && input[i]! <= "9") i += 1;
      }
      const mantissa = input.slice(start, i);
      if (mantissa === ".") {
        throw new ExpressionError(`a lone '.' at position ${start + 1} is not a number.`);
      }
      if (input[i] === "e" || input[i] === "E") {
        // Only consume the `e` if a valid exponent actually follows, so `1e` fails as a
        // trailing character rather than silently parsing as `1`.
        let j = i + 1;
        if (input[j] === "+" || input[j] === "-") j += 1;
        if (j < input.length && input[j]! >= "0" && input[j]! <= "9") {
          while (j < input.length && input[j]! >= "0" && input[j]! <= "9") j += 1;
          i = j;
        }
      }
      tokens.push({ kind: "number", value: Number(input.slice(start, i)), at: start });
      continue;
    }

    throw new ExpressionError(
      `unexpected character '${char}' at position ${i + 1}. Only numbers, ` +
        `+ - * / ^ and parentheses are allowed — no variables and no functions.`,
    );
  }

  return tokens;
}

/**
 * Recursive-descent evaluation. Parsing and arithmetic happen in one pass because there is
 * no second consumer of a syntax tree here, and the extra layer would only be ceremony.
 */
class Parser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly length: number,
  ) {}

  /** Entry point: the whole input must be one expression, with nothing left over. */
  evaluate(): number {
    const value = this.expression(0);
    const leftover = this.tokens[this.index];
    if (leftover !== undefined) {
      throw new ExpressionError(
        `unexpected '${this.text(leftover)}' at position ${leftover.at + 1}; ` +
          `the expression already ended before it.`,
      );
    }
    return value;
  }

  private expression(depth: number): number {
    let value = this.term(depth);
    for (;;) {
      const operator = this.takeOperator("+", "-");
      if (operator === undefined) return value;
      const right = this.term(depth);
      value = operator === "+" ? value + right : value - right;
    }
  }

  private term(depth: number): number {
    let value = this.unary(depth);
    for (;;) {
      const operator = this.takeOperator("*", "/");
      if (operator === undefined) return value;
      const right = this.unary(depth);
      if (operator === "*") {
        value = value * right;
        continue;
      }
      // Caught here rather than left to produce Infinity, because "division by zero" is the
      // fact the Model needs; "the result is not a finite number" would hide which step did it.
      if (right === 0) throw new ExpressionError("division by zero is undefined.");
      value = value / right;
    }
  }

  private unary(depth: number): number {
    if (depth >= MAX_DEPTH) {
      throw new ExpressionError(
        `the expression nests more than ${MAX_DEPTH} levels deep, which is deeper than this tool evaluates.`,
      );
    }
    const operator = this.takeOperator("+", "-");
    if (operator === undefined) return this.power(depth);
    const value = this.unary(depth + 1);
    return operator === "-" ? -value : value;
  }

  private power(depth: number): number {
    const base = this.primary(depth);
    if (this.takeOperator("^") === undefined) return base;
    // Right-hand side is `unary`, not `power`: that is what makes `^` right-associative.
    return base ** this.unary(depth + 1);
  }

  private primary(depth: number): number {
    const token = this.tokens[this.index];
    if (token === undefined) {
      throw new ExpressionError(
        `the expression ends at position ${this.length + 1} where a number was expected.`,
      );
    }

    if (token.kind === "number") {
      this.index += 1;
      return token.value;
    }

    if (token.value === "(") {
      this.index += 1;
      const value = this.expression(depth + 1);
      const closing = this.tokens[this.index];
      if (closing === undefined || closing.kind !== "operator" || closing.value !== ")") {
        throw new ExpressionError(
          `a '(' opened at position ${token.at + 1} is never closed.`,
        );
      }
      this.index += 1;
      return value;
    }

    throw new ExpressionError(
      `unexpected '${token.value}' at position ${token.at + 1}; a number was expected there.`,
    );
  }

  private takeOperator(...candidates: readonly string[]): string | undefined {
    const token = this.tokens[this.index];
    if (token === undefined || token.kind !== "operator") return undefined;
    if (!candidates.includes(token.value)) return undefined;
    this.index += 1;
    return token.value;
  }

  private text(token: Token): string {
    return token.kind === "number" ? String(token.value) : token.value;
  }
}

/**
 * Rounds away binary-representation noise so `0.1 + 0.2` reads as `0.3`.
 *
 * Significant digits rather than decimal places: a fixed number of decimals would print
 * `1e-9` as `0.00` and pad a 20-digit integer with meaningless zeros, corrupting exactly the
 * magnitudes a calculator is used for.
 *
 * Whole numbers skip the rounding entirely. `9007199254740993` carries 16 significant digits
 * and every one of them is deliberate; rounding it to 12 would replace correct digits with
 * zeros, which is a worse lie than the float imprecision the description already warns about.
 */
function format(value: number): string {
  // `-0` is arithmetically zero and reads as a mistake, so it is normalised away.
  if (value === 0) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
}

/**
 * The arithmetic Tool.
 *
 * Every failure path returns a sentence, never a throw and never something shaped like a
 * number, so the Model can tell an error from an answer and retry within the same
 * conversation.
 */
export const calculateTool = defineTool({
  name: "calculate",
  description:
    "Evaluate an arithmetic expression and return its value. Supports + - * / ^ " +
    "(exponentiation, right-associative, so 2^3^2 is 512), parentheses, unary minus, and " +
    "decimal or exponent literals such as 1.5 or 2e10. It has no variables, constants or " +
    "functions — sqrt, pi and log are not available. Results use double-precision floating " +
    "point, so integers beyond 2^53 (about 9e15) are imprecise and results are shown to 12 " +
    "significant digits.",
  schema: z.object({
    // Every parameter carries a description because the description is the only thing the
    // model sees explaining what the parameter means.
    expression: z
      .string()
      .describe("The arithmetic expression to evaluate, for example \"(17 + 25) * 2^3\"."),
  }),
  handler: ({ expression }) => {
    const source = expression.trim();
    if (source === "") {
      return 'Error: the expression is empty. Pass an arithmetic expression such as "17 + 25".';
    }

    let value: number;
    try {
      value = new Parser(tokenize(source), source.length).evaluate();
    } catch (error) {
      // Only our own parse failures become text. Anything else is a bug in this file and
      // deserves to surface as a crash rather than be reported to the model as bad input.
      if (!(error instanceof ExpressionError)) throw error;
      return `Error: ${error.message}`;
    }

    if (!Number.isFinite(value)) {
      return Number.isNaN(value)
        ? "Error: the result is undefined (not a number) — a fractional power of a negative number, such as (-4)^0.5, does this."
        : "Error: the result overflowed to infinity; it is too large for double-precision arithmetic.";
    }

    return format(value);
  },
});
