import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SmsProviderError } from "../errors";
import { createExotelProvider } from "../exotel";
import { createMsg91Provider } from "../msg91";
import { createTwilioProvider } from "../twilio";
import {
  DEFAULT_SMS_MESSAGE_TEMPLATE,
  type ExotelConfig,
  type Msg91Config,
  type SmsFetch,
  type TwilioConfig,
} from "../types";

const SEND_INPUT = {
  phone: "+919876543210",
  code: "123456",
  ttlSeconds: 300,
};

const MSG91_CONFIG: Msg91Config = {
  provider: "msg91",
  timeoutMs: 2_000,
  authKey: "test-msg91-auth-key",
  templateId: "test-msg91-template",
};

const TWILIO_CONFIG: TwilioConfig = {
  provider: "twilio",
  timeoutMs: 2_000,
  messageTemplate: DEFAULT_SMS_MESSAGE_TEMPLATE,
  accountSid: "AC11111111111111111111111111111111",
  authToken: "test-twilio-auth-token",
  fromNumber: "+919876543210",
  messagingServiceSid: null,
};

const EXOTEL_CONFIG: ExotelConfig = {
  provider: "exotel",
  timeoutMs: 2_000,
  messageTemplate: DEFAULT_SMS_MESSAGE_TEMPLATE,
  accountSid: "test-exotel-account",
  apiKey: "test-exotel-api-key",
  apiToken: "test-exotel-api-token",
  subdomain: "api.exotel.com",
  senderId: "TRDPLS",
  dltEntityId: "test-dlt-entity",
  dltTemplateId: "test-dlt-template",
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function formBody(init: RequestInit): URLSearchParams {
  assert.equal(typeof init.body, "string");
  return new URLSearchParams(init.body as string);
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
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

describe("MSG91 OTP adapter", () => {
  it("posts the documented v5 OTP payload", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse({ type: "success", message: "OTP sent" }),
    );

    await createMsg91Provider(MSG91_CONFIG, { fetchImpl }).send(SEND_INPUT);

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call?.url, "https://control.msg91.com/api/v5/otp");
    assert.equal(call?.init.method, "POST");
    assert.equal(
      (call?.init.headers as Record<string, string>).authkey,
      "test-msg91-auth-key",
    );
    assert.equal(
      (call?.init.headers as Record<string, string>)["Content-Type"],
      "application/json",
    );

    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    assert.deepEqual(body, {
      template_id: "test-msg91-template",
      mobile: "919876543210",
      otp: "123456",
      otp_expiry: 5,
    });
  });

  it("fails closed when MSG91 returns an error payload with HTTP 200", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ type: "error", message: "Invalid template" }),
    );

    const error = await expectSmsError(
      createMsg91Provider(MSG91_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );

    assert.equal(error.message.includes("123456"), false);
    assert.equal(error.message.includes("test-msg91-auth-key"), false);
  });

  it("fails closed on a malformed success body", async () => {
    const { fetchImpl } = recordingFetch(
      async () => new Response("<html>proxy</html>", { status: 200 }),
    );

    await expectSmsError(
      createMsg91Provider(MSG91_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );
  });
});

describe("Twilio Messages adapter", () => {
  it("sends an app-generated OTP through a From number", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse({ sid: "SM111", status: "queued" }, 201),
    );

    await createTwilioProvider(TWILIO_CONFIG, { fetchImpl }).send(SEND_INPUT);

    const [call] = calls;
    assert.equal(
      call?.url,
      "https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/Messages.json",
    );
    assert.equal(
      (call?.init.headers as Record<string, string>).Authorization,
      basicAuth(
        "AC11111111111111111111111111111111",
        "test-twilio-auth-token",
      ),
    );
    assert.equal(
      (call?.init.headers as Record<string, string>)["Content-Type"],
      "application/x-www-form-urlencoded",
    );

    const body = formBody(call?.init as RequestInit);
    assert.equal(body.get("To"), "+919876543210");
    assert.equal(body.get("From"), "+919876543210");
    assert.equal(body.get("MessagingServiceSid"), null);
    assert.match(body.get("Body") ?? "", /123456/);
    assert.match(body.get("Body") ?? "", /5 minutes/);
    assert.equal(body.get("Body")?.includes("test-twilio-auth-token"), false);
  });

  it("uses a Messaging Service SID when configured", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse({ sid: "SM222", status: "queued" }, 201),
    );

    await createTwilioProvider(
      {
        ...TWILIO_CONFIG,
        fromNumber: null,
        messagingServiceSid: "MG11111111111111111111111111111111",
      },
      { fetchImpl },
    ).send(SEND_INPUT);

    const body = formBody(calls[0]?.init as RequestInit);
    assert.equal(
      body.get("MessagingServiceSid"),
      "MG11111111111111111111111111111111",
    );
    assert.equal(body.get("From"), null);
  });

  it("normalizes a provider rejection without leaking the code or token", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse(
        {
          code: 21211,
          message: "The To number +919876543210 rejected OTP 123456",
          status: 400,
        },
        400,
      ),
    );

    const error = await expectSmsError(
      createTwilioProvider(TWILIO_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );

    assert.equal(error.status, 400);
    assert.equal(error.message.includes("123456"), false);
    assert.equal(error.message.includes("test-twilio-auth-token"), false);
  });

  it("fails closed when a successful response has no message SID", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ status: "queued" }, 201),
    );

    await expectSmsError(
      createTwilioProvider(TWILIO_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );
  });

  it("fails closed when the provider reports an explicit failure status", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ sid: "SM333", status: "failed" }, 201),
    );

    await expectSmsError(
      createTwilioProvider(TWILIO_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );
  });
});

describe("Exotel SMS adapter", () => {
  it("posts the documented DLT fields", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse({ SMSMessage: { Sid: "exotel-sid" } }),
    );

    await createExotelProvider(EXOTEL_CONFIG, { fetchImpl }).send(SEND_INPUT);

    const [call] = calls;
    assert.equal(
      call?.url,
      "https://api.exotel.com/v1/Accounts/test-exotel-account/Sms/send",
    );
    assert.equal(
      (call?.init.headers as Record<string, string>).Authorization,
      basicAuth("test-exotel-api-key", "test-exotel-api-token"),
    );

    const body = formBody(call?.init as RequestInit);
    assert.equal(body.get("From"), "TRDPLS");
    assert.equal(body.get("To"), "+919876543210");
    assert.match(body.get("Body") ?? "", /123456/);
    assert.equal(body.get("DltEntityId"), "test-dlt-entity");
    assert.equal(body.get("DltTemplateId"), "test-dlt-template");
    assert.equal(body.get("SmsType"), "transactional");
    assert.equal(body.get("Priority"), "high");
  });

  it("uses a configured Exotel subdomain", async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      jsonResponse({ SMSMessage: { Sid: "exotel-sid" } }),
    );

    await createExotelProvider(
      { ...EXOTEL_CONFIG, subdomain: "api.in.exotel.com" },
      { fetchImpl },
    ).send(SEND_INPUT);

    assert.equal(
      calls[0]?.url,
      "https://api.in.exotel.com/v1/Accounts/test-exotel-account/Sms/send",
    );
  });

  it("classifies an authentication failure", async () => {
    const { fetchImpl } = recordingFetch(
      async () => new Response("unauthorized", { status: 401 }),
    );

    await expectSmsError(
      createExotelProvider(EXOTEL_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "authentication",
    );
  });

  it("fails closed when a successful response has no message SID", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ SMSMessage: { Status: "queued" } }),
    );

    await expectSmsError(
      createExotelProvider(EXOTEL_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );
  });

  it("fails closed when the provider reports an explicit failure status", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ SMSMessage: { Sid: "exotel-sid", Status: "failed" } }),
    );

    await expectSmsError(
      createExotelProvider(EXOTEL_CONFIG, { fetchImpl }).send(SEND_INPUT),
      "rejected",
    );
  });
});
