import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleQuote, fetchGoogleQuote, googleCooldown, resetGoogle } from "../googlefinance.mjs";

test("Google Finance: an 'unusual traffic' page is reported as a block and pauses Google, not as a layout change", async () => {
  const sorry = `<html><body>${"x".repeat(300)} Our systems have detected unusual traffic from your computer network. <div id="recaptcha"></div></body></html>`;
  assert.throws(() => parseGoogleQuote(sorry, "TCS"), e => e.blocked === true);
  resetGoogle();
  const fetchImpl = async () => ({ status: 200, ok: true, url: "https://www.google.com/finance/quote/TCS:NSE", text: async () => sorry });
  await assert.rejects(fetchGoogleQuote("TCS", { fetchImpl }), /throttling this connection \("unusual traffic" check page\)/);
  assert.ok(googleCooldown() > Date.now(), "paused after a block");
  resetGoogle();
  await assert.rejects(fetchGoogleQuote("TCS", { fetchImpl: async () => ({ status: 200, ok: true, url: "https://www.google.com/sorry/index?continue=x", text: async () => "" }) }), /unusual traffic/);
  resetGoogle();
});
