import test from "node:test";
import assert from "node:assert/strict";
import { buildNetworth, ownerName, sanitizeItem } from "../networth.mjs";

test("net worth by person: you, your wife (any case), joint; synced accounts carry their holder", () => {
  assert.equal(ownerName(""), "Me"); assert.equal(ownerName(" self "), "Me"); assert.equal(ownerName("Wife"), "Wife");
  const items = [
    { ...sanitizeItem({ category: "epf", name: "EPF", value: 1200000 }), id: "a" },
    { ...sanitizeItem({ category: "epf", name: "Her EPF", value: 600000, owner: "Wife" }), id: "b" },
    { ...sanitizeItem({ category: "ppf", name: "Her PPF", value: 400000, owner: "wife" }), id: "c" },
    { ...sanitizeItem({ category: "homeloan", name: "Home loan", value: 2000000, owner: "Joint" }), id: "d" },
    { ...sanitizeItem({ category: "realestate", name: "Flat", value: 9000000, owner: "Joint" }), id: "e" }
  ];
  const nw = buildNetworth({ stocks: [{ account: "AB1", label: "Zerodha · AB1", value: 800000 }, { account: "XY9", label: "Zerodha · XY9", value: 300000, owner: "Wife" }], items });
  const by = Object.fromEntries(nw.people.map(p => [p.name, p]));
  assert.deepEqual(nw.people.map(p => p.name), ["Me", "Joint", "Wife"]);
  assert.equal(by.Me.net, 2000000); assert.equal(by.Wife.assets, 1300000); assert.equal(by.Joint.net, 7000000); assert.equal(by.Joint.liabilities, 2000000);
  assert.deepEqual(by.Wife.cats.map(c => c.id), ["epf", "ppf", "stocks"]);
  assert.equal(by.Me.net + by.Wife.net + by.Joint.net, nw.totals.net);
});
