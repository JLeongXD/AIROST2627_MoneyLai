const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const compiled = ts.transpileModule(
  fs.readFileSync("src/lib/ai/claim-check.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, {
  exports: exportsObject,
  require,
  Date,
  Set,
  JSON,
  Number,
  Error,
});
const { compareClaim, validateExtraction, checkSignature } = exportsObject;
const r = (amount = "100.00", date = "2026-11-21") => ({
  attachment_id: "a",
  readable: true,
  merchant: "Shop",
  amount,
  currency: "MYR",
  date,
  note: "",
});
const e = (receipts) => ({
  receipts,
  purpose_clear: true,
  purpose_note: "Materials for workshop",
  warnings: [],
});
test("Multiple receipt totals use exact cents", () => {
  const x = compareClaim(
    e([r("0.10"), { ...r("0.20"), attachment_id: "b" }]),
    "0.30",
    "2026-11-21",
  );
  assert.equal(x.amount_status, "match");
  assert.equal(x.receipt_total, "0.30");
});
test("Mismatch is flagged without changing any claim status", () => {
  const x = compareClaim(e([r()]), "200.00", "2026-11-20");
  assert.equal(x.amount_status, "mismatch");
  assert.equal(x.date_status, "mismatch");
  assert.equal(x.needs_attention, true);
});
test("Unreadable and foreign currency totals cannot pass", () => {
  for (const reading of [
    { ...r(), readable: false },
    { ...r(), currency: "USD" },
    r(null),
  ])
    assert.equal(
      compareClaim(e([reading]), "100.00", "2026-11-21").amount_status,
      "unable_to_verify",
    );
});
test("Missing dates are unknown, not matches", () =>
  assert.equal(
    compareClaim(e([r("100", null)]), "100.00", "2026-11-21").date_status,
    "unable_to_verify",
  ));
test("Malformed or fabricated output fields are rejected", () => {
  for (const reading of [
    r("1e2"),
    r("-1"),
    r("100", "2026-02-30"),
    { ...r(), attachment_id: "unknown" },
  ])
    assert.throws(() => validateExtraction(e([reading]), ["a"]));
  assert.throws(() => validateExtraction(e([]), ["a"]));
  assert.throws(() => validateExtraction(e([r(), r()]), ["a", "b"]));
});
test("Input changes invalidate reports but status changes do not", () => {
  const c = {
    amount: "100.00",
    purchase_date: "2026-11-21",
    category: "Materials",
    description: "Workshop tools",
    activity_id: "event",
  };
  const a = {
    id: "a",
    kind: "receipt",
    storage_path: "u/c/a.png",
    size_bytes: 20,
    mime_type: "image/png",
    created_at: "now",
  };
  const sig = checkSignature(c, [a]);
  assert.equal(sig, checkSignature({ ...c, status: "submitted" }, [a]));
  assert.notEqual(sig, checkSignature({ ...c, amount: "99" }, [a]));
  assert.notEqual(sig, checkSignature({ ...c, description: "other" }, [a]));
  assert.notEqual(sig, checkSignature(c, [{ ...a, id: "b" }]));
});
test("Duplicate warnings require attention even when amounts match", () => {
  const data = e([r()]);
  data.warnings = ["Possible duplicate receipt"];
  assert.equal(
    compareClaim(data, "100.00", "2026-11-21").needs_attention,
    true,
  );
});
