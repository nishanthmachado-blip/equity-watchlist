import test from "node:test";
import assert from "node:assert/strict";
import { peopleOf, shareOf, settleUp, sanitizeEntry, sanitizeSettlement } from "../expenses.mjs";

test("people: names among payment methods, or the list you set", () => {
  assert.deepEqual(peopleOf({ modes: ["Pluxee", "Gpay", "Credit Card", "Sophia", "Not given", "HDFC Bank", "Cash"] }), ["Sophia"]);
  assert.deepEqual(peopleOf({ people: ["Sophia", "Ravi"], modes: [] }), ["Sophia", "Ravi"]);
});
test("a spend paid by a person is owed to them; explicit shares and splits win", () => {
  const e = sanitizeEntry({ date: "2026-10-06", item: "Zepto", amount: 392, mode: "Sophia" }, { month: "2026-10" });
  assert.deepEqual(shareOf(e, ["Sophia"]), { person: "Sophia", dir: "owe", amount: 392, auto: true });
  const half = sanitizeEntry({ date: "2026-10-06", item: "Dinner", amount: 2000, mode: "GPay", share: { person: "Sophia", dir: "owed", amount: 1000 } }, { month: "2026-10" });
  assert.deepEqual(shareOf(half, ["Sophia"]), { person: "Sophia", dir: "owed", amount: 1000 });
  const capped = sanitizeEntry({ date: "2026-10-06", item: "X", amount: 100, share: { person: "Sophia", dir: "owed", amount: 900 } }, { month: "2026-10" });
  assert.equal(capped.share.amount, 100);
  const off = sanitizeEntry({ date: "2026-10-06", item: "Gift", amount: 500, mode: "Sophia", share: false }, { month: "2026-10" });
  assert.equal(shareOf(off, ["Sophia"]), null);
  assert.throws(() => sanitizeSettlement({ person: "Sophia", amount: 0, date: "2026-10-01" }, { month: "2026-10" }));
});
test("settle up: this month and the running balance across months", () => {
  const months = {
    "2026-09": { entries: [{ id: "a", date: "2026-09-03", item: "Groceries", amount: 3000, mode: "Sophia" }], settlements: [{ id: "s1", date: "2026-09-30", person: "Sophia", amount: 1000, dir: "paid" }] },
    "2026-10": { entries: [{ id: "b", date: "2026-10-06", item: "Zepto", amount: 400, mode: "Sophia" }, { id: "c", date: "2026-10-09", item: "Her phone bill", amount: 999, mode: "GPay", share: { person: "Sophia", dir: "owed", amount: 999 } }, { id: "d", date: "2026-10-10", item: "Milk", amount: 81, mode: "GPay" }],
      settlements: [{ id: "s2", date: "2026-10-20", person: "Sophia", amount: 200, dir: "received" }] },
    "2026-11": { entries: [{ id: "z", date: "2026-11-01", item: "Later", amount: 5000, mode: "Sophia" }] }
  };
  const [s] = settleUp(months, ["Sophia"], "2026-10");
  assert.equal(s.person, "Sophia");
  assert.equal(s.before, -2000, "Sept: she paid 3000, you paid back 1000 → you owe 2000");
  assert.deepEqual(s.totals, { owe: 400, owed: 999, paid: 0, received: 200 });
  assert.equal(s.monthNet, 999 - 400 - 200);
  assert.equal(s.net, -2000 + 399, "later months are not counted");
  assert.equal(s.owe[0].item, "Zepto"); assert.equal(s.owed[0].item, "Her phone bill");
  assert.equal(settleUp(months, [], "2026-10")[0].person, "Sophia", "explicit shares and payments still show without the people list");
});
