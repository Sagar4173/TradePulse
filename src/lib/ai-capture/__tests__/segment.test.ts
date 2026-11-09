import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { segmentCaptureText } from "../segment";

describe("segmentCaptureText", () => {
  it("splits the required Hindi/Hinglish example into three items", () => {
    const lines = segmentCaptureText(
      "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti",
    );

    assert.equal(lines.length, 3);
    assert.deepEqual(
      lines.map((line) => ({
        originalText: line.originalText,
        description: line.description,
        quantity: line.quantity,
        unitKind: line.unitKind,
        packSizeHint: line.packSizeHint,
      })),
      [
        {
          originalText: "5 peti biscuit chhota",
          description: "biscuit chhota",
          quantity: 5,
          unitKind: "CASE",
          packSizeHint: null,
        },
        {
          originalText: "2 peti washing powder 1 kilo",
          description: "washing powder 1 kilo",
          quantity: 2,
          unitKind: "CASE",
          packSizeHint: "1 kg",
        },
        {
          originalText: "chai patti 250 wala 1 peti",
          description: "chai patti 250 wala",
          quantity: 1,
          unitKind: "CASE",
          packSizeHint: "250",
        },
      ],
    );
  });

  it("keeps a missing unit explicit instead of guessing cases", () => {
    const [line] = segmentCaptureText("bhaiya 5 biscuit");

    assert.equal(line.description, "biscuit");
    assert.equal(line.quantity, 5);
    assert.equal(line.unitKind, "UNKNOWN");
  });

  it("distinguishes packets from cases", () => {
    const lines = segmentCaptureText(
      "5 packet biscuit, 2 peti washing powder",
    );

    assert.equal(lines.length, 2);
    assert.equal(lines[0].unitKind, "PIECE");
    assert.equal(lines[0].quantity, 5);
    assert.equal(lines[1].unitKind, "CASE");
    assert.equal(lines[1].quantity, 2);
  });

  it("splits multiple quantity anchors even without commas", () => {
    const lines = segmentCaptureText(
      "5 peti biscuit chhota 2 peti washing powder",
    );

    assert.equal(lines.length, 2);
    assert.equal(lines[0].description, "biscuit chhota");
    assert.equal(lines[0].quantity, 5);
    assert.equal(lines[1].description, "washing powder");
    assert.equal(lines[1].quantity, 2);
  });

  it("keeps product-first lists attached to their own quantities", () => {
    const lines = segmentCaptureText("biscuit 5 peti soap 2 peti");

    assert.equal(lines.length, 2);
    assert.equal(lines[0].description, "biscuit");
    assert.equal(lines[0].quantity, 5);
    assert.equal(lines[1].description, "soap");
    assert.equal(lines[1].quantity, 2);
  });

  it("treats the spoken word plus as a line separator", () => {
    const lines = segmentCaptureText("5 peti biscuit plus 2 peti soap");

    assert.equal(lines.length, 2);
    assert.equal(lines[0].description, "biscuit");
    assert.equal(lines[0].quantity, 5);
    assert.equal(lines[1].description, "soap");
    assert.equal(lines[1].quantity, 2);
  });

  it("returns an explicit unknown line when there is no quantity", () => {
    const [line] = segmentCaptureText("glucose biscuit");

    assert.equal(line.description, "glucose biscuit");
    assert.equal(line.quantity, null);
    assert.equal(line.unitKind, "UNKNOWN");
  });

  it("returns no lines for empty input", () => {
    assert.deepEqual(segmentCaptureText("   "), []);
  });
});
