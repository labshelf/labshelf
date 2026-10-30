// Handoff block schemas (research/schemas.md): parseBlocks extracts ```yaml <kind>/v1 blocks, validate returns field-path errors.
import { parse } from "yaml";

export const KINDS = ["plan", "session", "spec", "report", "brief", "diagnosis", "verdict"];

const BLOCK = /^```yaml[ \t]+([a-z_]+)\/v1[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm;

/**
 * Returns `{kind: value}` for every ```yaml <kind>/v1 block in `text`.
 * A YAML syntax error or a second block of the same kind is stored as an `Error` instead of a value;
 * `validate` turns it into an error string, so neither function throws.
 */
export function parseBlocks(text) {
  const blocks = {};
  for (const [, kind, body] of String(text ?? "").matchAll(BLOCK)) {
    if (kind in blocks) {
      blocks[kind] = new Error(`duplicate ${kind}/v1 block (at most one per message)`);
      continue;
    }
    try {
      blocks[kind] = parse(body);
    } catch (error) {
      blocks[kind] = new Error(String(error?.message ?? error).split("\n")[0]);
    }
  }
  return blocks;
}

const at = (path, key) => (path ? `${path}.${key}` : key);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const describe = (path) => path || "value";

// A check is (value, path, errors) => void; it pushes "<path>: <problem>" strings.
const string = (value, path, errors) => {
  if (typeof value !== "string") errors.push(`${describe(path)}: expected a string`);
};
const bool = (value, path, errors) => {
  if (typeof value !== "boolean") errors.push(`${describe(path)}: expected true or false`);
};
const lines = (value, path, errors) => {
  if (typeof value !== "string" || !/^\d+-\d+$/.test(value)) errors.push(`${describe(path)}: expected "<from>-<to>" (digits), e.g. "10-20"`);
};
const literal = (expected) => (value, path, errors) => {
  if (value !== expected) errors.push(`${describe(path)}: expected "${expected}"`);
};
const oneOf = (...values) => (value, path, errors) => {
  if (!values.includes(value)) errors.push(`${describe(path)}: expected one of ${values.join(", ")}`);
};
const nullable = (check) => (value, path, errors) => {
  if (value !== null) check(value, path, errors);
};
const list = (check) => (value, path, errors) => {
  if (!Array.isArray(value)) return errors.push(`${describe(path)}: expected a list`);
  value.forEach((item, index) => check(item, `${path}[${index}]`, errors));
};
// Strict object: every key in `required` must exist, keys in `optional` may, any other key is an error.
const shape = (required, optional = {}, after) => (value, path, errors) => {
  if (!isObject(value)) return errors.push(`${describe(path)}: expected an object`);
  for (const [key, check] of Object.entries(required)) {
    if (key in value) check(value[key], at(path, key), errors);
    else errors.push(`${at(path, key)}: required key is missing`);
  }
  for (const key of Object.keys(value)) {
    if (key in required) continue;
    if (key in optional) optional[key](value[key], at(path, key), errors);
    else errors.push(`${at(path, key)}: unknown key`);
  }
  after?.(value, path, errors);
};

const strings = list(string);
const ids = list(string);
const fileRef = shape({ path: string, lines, why: string });
const acceptanceItem = shape({ id: string, check: string });
const runner = shape({ agent: string, model: oneOf("sonnet", "opus", "fable") });

// tests is {hidden, command} or {none}; a partial spec (diagnosis) may omit command.
const testsField = (partial) => (value, path, errors) => {
  if (!isObject(value)) return errors.push(`${describe(path)}: expected {hidden, command} or {none}`);
  if ("none" in value) {
    shape({ none: string })(value, path, errors);
    if (Object.keys(value).length > 1) errors.push(`${describe(path)}: none cannot be combined with hidden or command`);
  } else if (partial) shape({ hidden: strings }, { command: string })(value, path, errors);
  else shape({ hidden: strings, command: string })(value, path, errors);
};

const specFields = (partial) => ({
  id: string,
  plan: string,
  goal: string,
  level: oneOf("task", "behaviour", "contract"),
  runner,
  sha: string,
  depends_on: ids,
  edit: list(fileRef),
  create: strings,
  read: list(fileRef),
  callers: list(shape({ symbol: string, path: string, lines })),
  seams: list(shape({ path: string, signature: string })),
  decided: strings,
  acceptance: list(acceptanceItem),
  tests: testsField(partial),
  commands: strings,
  do_not_touch: strings,
});

function specShape({ withSchema, required, partial = false }) {
  const fields = specFields(partial);
  const req = Object.fromEntries(required.map((key) => [key, fields[key]]));
  const opt = Object.fromEntries(Object.entries(fields).filter(([key]) => !required.includes(key)));
  return withSchema ? shape({ schema: literal("spec/v1"), ...req }, opt) : shape(req, opt);
}

const SPEC_REQUIRED = ["id", "goal", "level", "runner", "edit", "acceptance", "tests"];

const reportAfter = (value, path, errors) => {
  if (value.status === "missing" && (!Array.isArray(value.missing) || value.missing.length === 0)) {
    errors.push(`${at(path, "missing")}: required (non-empty) when status is missing`);
  }
};

const VERDICT_ROUTE = { code_wrong: "hint", test_wrong: "fix", spec_ambiguous: "question" };
const verdictAfter = (value, path, errors) => {
  const field = VERDICT_ROUTE[value.verdict];
  if (field && !(field in value)) errors.push(`${at(path, field)}: required when verdict is ${value.verdict}`);
};

const SCHEMAS = {
  plan: shape({
    schema: literal("plan/v1"),
    slug: string,
    title: string,
    status: oneOf("draft", "approved", "in_progress", "done"),
    level: oneOf("N2", "N3"),
    goal: string,
    decisions: list(shape({ id: string, text: string, why: string })),
    acceptance: list(acceptanceItem),
    sessions: list(shape({ id: string, file: string, depends_on: ids, owns: strings })),
  }),
  session: shape(
    {
      schema: literal("session/v1"),
      id: string,
      goal: string,
      depends_on: ids,
      owns: strings,
      status: oneOf("pending", "blocked", "done"),
      packages: list(specShape({ withSchema: false, required: SPEC_REQUIRED })),
    },
    { milestone: bool, blocked_reason: nullable(string) },
  ),
  spec: specShape({ withSchema: true, required: SPEC_REQUIRED }),
  report: shape(
    {
      schema: literal("report/v1"),
      spec: string,
      status: oneOf("done", "blocked_tests", "missing", "failed"),
      changes: list(shape({ path: string, what: string })),
      acceptance: list(shape({ id: string, result: oneOf("pass", "fail", "unchecked") }, { note: string })),
    },
    { missing: list(shape({ need: string, why: string })), not_touched: strings, concerns: strings },
    reportAfter,
  ),
  brief: shape(
    { schema: literal("brief/v1"), area: string, question: string, sha: string },
    {
      reuse: list(shape({ symbol: string, path: string, lines, why: string })),
      edit: list(fileRef),
      read: list(fileRef),
      callers: list(shape({ symbol: string, path: string, lines })),
      tests: list(shape({ path: string, covers: string })),
      contracts: strings,
      commands: strings,
      risks: strings,
    },
  ),
  diagnosis: shape(
    {
      schema: literal("diagnosis/v1"),
      red: shape({ command: string, failure: string }),
      hypotheses: list(shape({ status: oneOf("confirmed", "falsified", "untested"), path: string, lines, claim: string, evidence: string })),
      root_cause: shape({ path: string, lines, claim: string }),
      regression_test: shape({ path: string, name: string }),
      spec: specShape({ withSchema: false, required: ["goal"], partial: true }),
    },
    { call_chain: list(shape({ path: string, lines })), also_affected: strings },
  ),
  verdict: shape(
    {
      schema: literal("verdict/v1"),
      spec: string,
      verdict: oneOf("code_wrong", "test_wrong", "spec_ambiguous"),
      // Per failing test: its name, the spec item it is judged by, and why in spec terms (no test code or copied literals).
      evidence: list(shape({ test: string, spec_ref: string, reason: string })),
    },
    { hint: string, fix: string, question: string },
    verdictAfter,
  ),
};

/** Returns the errors of `value` against the `kind` schema as `"<field path>: <problem>"` strings; `[]` means valid. Never throws. */
export function validate(kind, value) {
  if (!Object.hasOwn(SCHEMAS, kind)) return [`${kind}: unknown kind (expected one of ${KINDS.join(", ")})`];
  if (value instanceof Error) return [`yaml: ${value.message}`];
  const errors = [];
  SCHEMAS[kind](value, "", errors);
  return errors;
}
