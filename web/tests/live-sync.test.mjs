import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(name, environment = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, ...environment });
  return exports;
}
const { createLiveQuery } = load("live-query");
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Refresh bursts are serialized and coalesced; the final read wins", async () => {
  const pending = [], results = [];
  const query = createLiveQuery(() => new Promise((resolve) => pending.push(resolve)), (data) => results.push(data), assert.fail);
  void query.refresh();
  void query.refresh();
  void query.refresh();
  assert.equal(pending.length, 1);
  pending[0]("old");
  await settle();
  assert.equal(pending.length, 2);
  pending[1]("new");
  await settle();
  assert.deepEqual(results, ["old", "new"]);
  query.stop();
});

test("Unmount or identity changes discard late responses and queued work", async () => {
  let resolve;
  const results = [];
  const query = createLiveQuery(() => new Promise((r) => { resolve = r; }), (data) => results.push(data), assert.fail);
  void query.refresh();
  void query.refresh();
  query.stop();
  resolve("previous account");
  await settle();
  await query.refresh();
  assert.equal(results.length, 0);
});

test("Read failure is reported and the next refresh recovers", async () => {
  let fail = true;
  const results = [], errors = [];
  const query = createLiveQuery(async () => { if (fail) throw Error("offline"); return "paid"; }, (data) => results.push(data), (error) => errors.push(error.message));
  await query.refresh();
  fail = false;
  await query.refresh();
  assert.deepEqual(errors, ["offline"]);
  assert.deepEqual(results, ["paid"]);
  query.stop();
});

function scheduler() {
  const win = new EventTarget(), doc = new EventTarget(), timers = new Map();
  doc.visibilityState = "visible";
  const navigator = { onLine: true };
  let next = 0;
  win.setInterval = (fn, ms) => { assert.equal(ms, 5000); timers.set(++next, fn); return next; };
  win.clearInterval = (id) => timers.delete(id);
  return { win, doc, timers, navigator, ...load("live-sync", { window: win, document: doc, navigator }) };
}

test("All mounted queries share one timer, pause when hidden/offline, and resume immediately", () => {
  const s = scheduler();
  let a = 0, b = 0;
  const stopA = s.subscribeToRefresh(() => a++), stopB = s.subscribeToRefresh(() => b++);
  assert.equal(s.timers.size, 1);
  const tick = () => [...s.timers.values()].forEach((fn) => fn());
  tick();
  assert.equal(a, 1); assert.equal(b, 1);
  s.doc.visibilityState = "hidden";
  tick(); assert.equal(a, 1);
  s.doc.visibilityState = "visible";
  s.doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(a, 2);
  s.navigator.onLine = false;
  tick(); assert.equal(a, 2);
  assert.equal(s.getSyncStatus(), "offline");
  s.navigator.onLine = true;
  s.win.dispatchEvent(new Event("online"));
  assert.equal(a, 3);
  stopA(); tick(); assert.equal(a, 3); assert.equal(b, 4);
  stopB(); assert.equal(s.timers.size, 0);
  s.win.dispatchEvent(new Event("focus")); assert.equal(b, 4);
});

test("A successful query cannot hide another query's synchronization failure", () => {
  const s = scheduler(), a = {}, b = {};
  s.reportSyncFailure(a, true);
  s.reportSyncFailure(b, false);
  assert.equal(s.getSyncStatus(), "delayed");
  s.reportSyncFailure(a, false);
  assert.equal(s.getSyncStatus(), "active");
});
