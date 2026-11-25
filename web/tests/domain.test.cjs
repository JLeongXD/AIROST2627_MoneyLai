const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");
const filename = path.join(__dirname, "../src/lib/domain.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const domain = new Module(filename, module);
domain.filename = filename;
domain.paths = module.paths;
domain._compile(compiled, filename);
const { amountError, fileError, money, today, STATUS_LABELS } = domain.exports;
test("Accept positive money with up to two decimals", () => {
  for (const value of ["1", "0.01", "120.50", "9999999999.99"])
    assert.equal(amountError(value), null);
});
test("Reject zero claims, negative amounts, scientific notation and excess precision", () => {
  for (const value of ["0", "-1", "1.001", "1e3", "", "NaN", "10000000000"])
    assert.ok(amountError(value));
});
test("Activity budgets can be zero", () =>
  assert.equal(amountError("0", true), null));
test("Accept only allowed receipt formats within the size limit", () => {
  for (const type of ["image/jpeg", "image/png", "application/pdf"])
    assert.equal(fileError({ size: 5 * 1024 * 1024, type }), null);
});
test("Reject oversized and empty uploads", () => {
  assert.ok(fileError({ size: 0, type: "image/png" }));
  assert.ok(fileError({ size: 5 * 1024 * 1024 + 1, type: "image/png" }));
});
test("Reject active content such as SVG and HTML attachments", () => {
  for (const type of ["image/svg+xml", "text/html"])
    assert.ok(fileError({ size: 100, type }));
});
test("Format stored decimal amounts as MYR", () => {
  assert.match(money("120.50"), /120\.50/);
  assert.match(money(null), /0\.00/);
});
test("All claim states have a user-facing label", () => {
  assert.deepEqual(Object.keys(STATUS_LABELS).sort(), [
    "approved",
    "draft",
    "needs_info",
    "paid",
    "rejected",
    "submitted",
  ]);
});
test("Local business date uses ISO date format", () =>
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/));
