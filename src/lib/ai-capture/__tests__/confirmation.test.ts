import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCaptureConfirmationPayload } from "../confirmation";

function validPayload() {
  return {
    lines: [
      {
        phrase: "chhota biscuit",
        selectedSku: "SKU-BS-075",
        quantity: 2,
        confirmed: true,
      },
    ],
  };
}

describe("parseCaptureConfirmationPayload", () => {
  it("accepts confirmed case quantities and trims the display phrase", () => {
    const payload = validPayload();
    payload.lines[0].phrase = "  chhota biscuit  ";

    const result = parseCaptureConfirmationPayload(payload);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.lines, [
        {
          phrase: "chhota biscuit",
          selectedSku: "SKU-BS-075",
          quantity: 2,
        },
      ]);
    }
  });

  it("rejects unconfirmed, empty, or malformed line collections", () => {
    const unconfirmed = validPayload();
    unconfirmed.lines[0].confirmed = false;
    const extraLineKey = validPayload();
    Object.assign(extraLineKey.lines[0], { pricePaise: 100 });

    assert.equal(parseCaptureConfirmationPayload(unconfirmed).ok, false);
    assert.equal(parseCaptureConfirmationPayload(extraLineKey).ok, false);
    assert.equal(parseCaptureConfirmationPayload({ lines: [] }).ok, false);
    assert.equal(
      parseCaptureConfirmationPayload({
        lines: Array.from({ length: 51 }, () => validPayload().lines[0]),
      }).ok,
      false,
    );
  });

  it("accepts an empty phrase for a manually selected product", () => {
    const payload = validPayload();
    payload.lines[0].phrase = "   ";

    const result = parseCaptureConfirmationPayload(payload);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.lines[0].phrase, "");
    }
  });

  it("rejects unknown fields and malformed values", () => {
    assert.equal(
      parseCaptureConfirmationPayload({ ...validPayload(), rawText: "secret" })
        .ok,
      false,
    );
    assert.equal(parseCaptureConfirmationPayload(null).ok, false);
    assert.equal(parseCaptureConfirmationPayload({}).ok, false);

    for (const quantity of [0, -1, 1.5, 1000]) {
      const payload = validPayload();
      payload.lines[0].quantity = quantity;
      assert.equal(parseCaptureConfirmationPayload(payload).ok, false);
    }

    const badSku = validPayload();
    badSku.lines[0].selectedSku = "../SKU";
    assert.equal(parseCaptureConfirmationPayload(badSku).ok, false);

    const longPhrase = validPayload();
    longPhrase.lines[0].phrase = "x".repeat(301);
    assert.equal(parseCaptureConfirmationPayload(longPhrase).ok, false);

    const boundaryPhrase = validPayload();
    boundaryPhrase.lines[0].phrase = "x".repeat(200);
    assert.equal(parseCaptureConfirmationPayload(boundaryPhrase).ok, true);

    const justOverPhrase = validPayload();
    justOverPhrase.lines[0].phrase = "x".repeat(201);
    assert.equal(parseCaptureConfirmationPayload(justOverPhrase).ok, false);
  });
});
