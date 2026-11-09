import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { postSmsRequest } from "../http";
import { SmsProviderError } from "../errors";
import type { SmsFetch } from "../types";

const REQUEST = {
  url: "https://sms.example.invalid/send",
  headers: {
    "Content-Type": "application/json",
    authkey: "test-auth-key",
  },
  body: '{"otp":"123456"}',
  timeoutMs: 2_000,
};

type FetchCall = { url: string; init: RequestInit };

function recordingFetch(
  handler: (call: FetchCall, index: number) => Promise<Response>,
): { fetchImpl: SmsFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: SmsFetch = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };

  return { fetchImpl, calls };
}

function jsonResponse(
  body: string,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(body, { status, headers });
}

async function expectSmsError(
  promise: Promise<unknown>,
  category: SmsProviderError["category"],
): Promise<SmsProviderError> {
  let caught: unknown;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof SmsProviderError, `expected ${category} error`);
  assert.equal(caught.category, category);
  return caught;
}

describe("postSmsRequest", () => {
  it("posts the prepared request and returns a successful response body", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse('{"ok":true}', 201),
    );

    const response = await postSmsRequest(REQUEST, { fetchImpl });

    assert.equal(response.status, 201);
    assert.equal(response.body, '{"ok":true}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, REQUEST.url);
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal(calls[0]?.init.redirect, "error");
    assert.deepEqual(calls[0]?.init.headers, REQUEST.headers);
    assert.equal(calls[0]?.init.body, REQUEST.body);
  });

  it("retries one rate-limited request after a short Retry-After", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, calls } = recordingFetch(async (_call, index) =>
      index === 0
        ? jsonResponse("rate limited", 429, { "Retry-After": "0.25" })
        : jsonResponse('{"ok":true}'),
    );

    const response = await postSmsRequest(REQUEST, {
      fetchImpl,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [250]);
  });

  it("does not retry a rate-limited request without Retry-After", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse("rate limited", 429),
    );

    await expectSmsError(
      postSmsRequest(REQUEST, { fetchImpl }),
      "rate_limited",
    );

    assert.equal(calls.length, 1);
  });

  it("does not retry a rate-limited request with a malformed Retry-After", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse("rate limited", 429, {
        "Retry-After": "wait-a-moment",
      }),
    );

    await expectSmsError(
      postSmsRequest(REQUEST, { fetchImpl }),
      "rate_limited",
    );

    assert.equal(calls.length, 1);
  });

  it("honors a short Retry-After header on the single retry", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, calls } = recordingFetch(async (_call, index) =>
      index === 0
        ? jsonResponse("rate limited", 429, { "Retry-After": "1" })
        : jsonResponse('{"ok":true}'),
    );

    await postSmsRequest(REQUEST, {
      fetchImpl,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [1_000]);
  });

  it("does not retry when the provider asks for a long wait", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse("rate limited", 429, { "Retry-After": "60" }),
    );

    await expectSmsError(
      postSmsRequest(REQUEST, { fetchImpl }),
      "rate_limited",
    );

    assert.equal(calls.length, 1);
  });

  it("does not retry a server error", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse("internal error", 503),
    );

    await expectSmsError(postSmsRequest(REQUEST, { fetchImpl }), "server");

    assert.equal(calls.length, 1);
  });

  it("does not retry a network failure", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expectSmsError(postSmsRequest(REQUEST, { fetchImpl }), "network");

    assert.equal(calls.length, 1);
  });

  it("classifies a timeout without retrying", async () => {
    const { fetchImpl, calls } = recordingFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    await expectSmsError(postSmsRequest(REQUEST, { fetchImpl }), "timeout");

    assert.equal(calls.length, 1);
  });

  it("classifies an authentication failure without echoing the response body", async () => {
    const body = "authkey=super-secret-auth-key was rejected";
    const { fetchImpl } = recordingFetch(async () => jsonResponse(body, 401));

    const error = await expectSmsError(
      postSmsRequest(REQUEST, { fetchImpl }),
      "authentication",
    );

    assert.equal(error.message.includes("super-secret-auth-key"), false);
    assert.equal(error.message.includes(body), false);
    assert.equal(error.status, 401);
  });

  it("classifies a rejected request without echoing the response body", async () => {
    const body = '{"message":"otp 123456 is invalid for 919876543210"}';
    const { fetchImpl } = recordingFetch(async () => jsonResponse(body, 400));

    const error = await expectSmsError(
      postSmsRequest(REQUEST, { fetchImpl }),
      "rejected",
    );

    assert.equal(error.message.includes("123456"), false);
    assert.equal(error.message.includes(body), false);
  });
});
