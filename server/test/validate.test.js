/** Unit tests for the server-side input validators (server/lib/validate.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validEmail,
  validHttpUrl,
  validName,
  validE164,
  validSessionId,
  validMessages,
  validTranscript,
} from "../lib/validate.js";

test("validEmail accepts well-formed addresses", () => {
  assert.ok(validEmail("dev@example.com"));
  assert.ok(validEmail("first.last+tag@sub.example.co"));
});

test("validEmail rejects malformed or non-string input", () => {
  assert.equal(validEmail("no-at-sign"), false);
  assert.equal(validEmail("spaces @example.com"), false);
  assert.equal(validEmail("missing@tld"), false);
  assert.equal(validEmail(""), false);
  assert.equal(validEmail(null), false);
  assert.equal(validEmail(42), false);
  assert.equal(validEmail(`${"a".repeat(250)}@example.com`), false); // > 254 chars
});

test("validHttpUrl accepts public http(s) URLs", () => {
  assert.ok(validHttpUrl("https://example.com"));
  assert.ok(validHttpUrl("http://www.example.org/path?q=1"));
});

test("validHttpUrl rejects non-http(s), hostless, and SSRF-risky URLs", () => {
  assert.equal(validHttpUrl("ftp://example.com"), false);
  assert.equal(validHttpUrl("javascript:alert(1)"), false);
  assert.equal(validHttpUrl("https://localhost"), false);
  assert.equal(validHttpUrl("http://127.0.0.1"), false);
  assert.equal(validHttpUrl("http://10.0.0.5"), false);
  assert.equal(validHttpUrl("http://192.168.1.1"), false);
  assert.equal(validHttpUrl("http://172.16.0.1"), false);
  assert.equal(validHttpUrl("http://169.254.169.254"), false); // cloud metadata
  assert.equal(validHttpUrl("http://box.local"), false);
  assert.equal(validHttpUrl("http://svc.internal"), false);
  assert.equal(validHttpUrl("http://nodot"), false);
  assert.equal(validHttpUrl("not a url"), false);
});

test("validName enforces trimmed 2..120 length", () => {
  assert.ok(validName("Al"));
  assert.ok(validName("  Alice  "));
  assert.equal(validName("A"), false);
  assert.equal(validName("   "), false);
  assert.equal(validName("x".repeat(121)), false);
  assert.equal(validName(123), false);
});

test("validE164 accepts E.164 and rejects the rest", () => {
  assert.ok(validE164("+15551234567"));
  assert.ok(validE164("+447911123456"));
  assert.equal(validE164("15551234567"), false); // no +
  assert.equal(validE164("+0123456789"), false); // leading 0 after +
  assert.equal(validE164("+123"), false); // too short
  assert.equal(validE164("+1-555-123-4567"), false); // punctuation
});

test("validSessionId enforces charset and length bounds", () => {
  assert.ok(validSessionId("sess_test_00000001"));
  assert.ok(validSessionId("A.b-C_90")); // 8 chars, allowed charset
  assert.equal(validSessionId("short7c"), false); // 7 chars, below minimum
  assert.equal(validSessionId("has space here"), false);
  assert.equal(validSessionId("bad/char/here"), false);
  assert.equal(validSessionId("x".repeat(129)), false);
});

test("validMessages requires a bounded array of role/content turns", () => {
  assert.ok(validMessages([{ role: "user", content: "hi" }]));
  assert.ok(
    validMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  );
  assert.equal(validMessages([]), false);
  assert.equal(validMessages("nope"), false);
  assert.equal(validMessages([{ role: "system", content: "x" }]), false);
  assert.equal(validMessages([{ role: "user", content: "" }]), false);
  assert.equal(validMessages([{ role: "user", content: "x".repeat(8001) }]), false);
  assert.equal(validMessages(new Array(201).fill({ role: "user", content: "x" })), false);
});

test("validTranscript allows empty and bounded entries, rejects bad shapes", () => {
  assert.ok(validTranscript([])); // a call with no speech is allowed
  assert.ok(validTranscript([{ role: "user", content: "hi", at: "2026-07-20T00:00:00Z" }]));
  assert.ok(validTranscript([{ role: "assistant", content: "" }])); // empty content permitted
  assert.equal(validTranscript("nope"), false);
  assert.equal(validTranscript([{ role: "system", content: "x" }]), false);
  assert.equal(validTranscript([{ role: "user", content: "x", at: 123 }]), false);
  assert.equal(validTranscript(new Array(2001).fill({ role: "user", content: "x" })), false);
});
