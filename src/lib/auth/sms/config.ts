import {
  DEFAULT_SMS_MESSAGE_TEMPLATE,
  DEFAULT_SMS_TIMEOUT_MS,
  MAX_SMS_TIMEOUT_MS,
  MIN_SMS_TIMEOUT_MS,
  SMS_PROVIDER_NAMES,
  type ExotelConfig,
  type Msg91Config,
  type SmsConfig,
  type SmsProviderName,
  type TwilioConfig,
} from "./types";

type Environment = Record<string, string | undefined>;

export { DEFAULT_SMS_TIMEOUT_MS } from "./types";

export type SmsConfigResult =
  | { ok: true; config: SmsConfig }
  | { ok: false; errors: string[] };

const MAX_MESSAGE_TEMPLATE_LENGTH = 500;
const DEFAULT_EXOTEL_SUBDOMAIN = "api.exotel.com";

function readValue(env: Environment, name: string): string | null {
  const raw = env[name];

  if (raw === undefined) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function required(
  env: Environment,
  name: string,
  errors: string[],
  context: string,
): string {
  const value = readValue(env, name);

  if (!value) {
    errors.push(`${name} is required for ${context}.`);
    return "";
  }

  return value;
}

function readProviderName(
  env: Environment,
  errors: string[],
): SmsProviderName | null {
  const raw = readValue(env, "AUTH_SMS_PROVIDER");

  if (!raw) {
    errors.push("AUTH_SMS_PROVIDER is required.");
    return null;
  }

  const normalized = raw.toLowerCase();

  if (!(SMS_PROVIDER_NAMES as readonly string[]).includes(normalized)) {
    errors.push(
      `AUTH_SMS_PROVIDER must be one of: ${SMS_PROVIDER_NAMES.join(", ")}.`,
    );
    return null;
  }

  return normalized as SmsProviderName;
}

function readTimeout(env: Environment, errors: string[]): number {
  const raw = readValue(env, "AUTH_SMS_TIMEOUT_MS");

  if (raw === null) {
    return DEFAULT_SMS_TIMEOUT_MS;
  }

  if (!/^\d+$/.test(raw)) {
    errors.push(
      `AUTH_SMS_TIMEOUT_MS must be an integer between ${MIN_SMS_TIMEOUT_MS} and ${MAX_SMS_TIMEOUT_MS}.`,
    );
    return DEFAULT_SMS_TIMEOUT_MS;
  }

  const parsed = Number(raw);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_SMS_TIMEOUT_MS ||
    parsed > MAX_SMS_TIMEOUT_MS
  ) {
    errors.push(
      `AUTH_SMS_TIMEOUT_MS must be an integer between ${MIN_SMS_TIMEOUT_MS} and ${MAX_SMS_TIMEOUT_MS}.`,
    );
    return DEFAULT_SMS_TIMEOUT_MS;
  }

  return parsed;
}

function readMessageTemplate(env: Environment, errors: string[]): string {
  const value = readValue(env, "AUTH_SMS_MESSAGE_TEMPLATE");

  if (value === null) {
    return DEFAULT_SMS_MESSAGE_TEMPLATE;
  }

  if (!value.includes("{code}")) {
    errors.push("AUTH_SMS_MESSAGE_TEMPLATE must contain the {code} placeholder.");
    return DEFAULT_SMS_MESSAGE_TEMPLATE;
  }

  if (value.length > MAX_MESSAGE_TEMPLATE_LENGTH) {
    errors.push(
      `AUTH_SMS_MESSAGE_TEMPLATE must be at most ${MAX_MESSAGE_TEMPLATE_LENGTH} characters.`,
    );
    return DEFAULT_SMS_MESSAGE_TEMPLATE;
  }

  return value;
}

function loadMsg91Config(
  env: Environment,
  errors: string[],
  base: { timeoutMs: number },
): Msg91Config {
  return {
    provider: "msg91",
    ...base,
    authKey: required(env, "AUTH_SMS_MSG91_AUTH_KEY", errors, "MSG91"),
    templateId: required(env, "AUTH_SMS_MSG91_TEMPLATE_ID", errors, "MSG91"),
  };
}

function loadTwilioConfig(
  env: Environment,
  errors: string[],
  base: { timeoutMs: number; messageTemplate: string },
): TwilioConfig {
  const fromNumber = readValue(env, "AUTH_SMS_TWILIO_FROM_NUMBER");
  const messagingServiceSid = readValue(
    env,
    "AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID",
  );

  if (fromNumber && messagingServiceSid) {
    errors.push(
      "Configure exactly one of AUTH_SMS_TWILIO_FROM_NUMBER or AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID.",
    );
  } else if (!fromNumber && !messagingServiceSid) {
    errors.push(
      "One of AUTH_SMS_TWILIO_FROM_NUMBER or AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID is required for Twilio.",
    );
  }

  return {
    provider: "twilio",
    ...base,
    accountSid: required(env, "AUTH_SMS_TWILIO_ACCOUNT_SID", errors, "Twilio"),
    authToken: required(env, "AUTH_SMS_TWILIO_AUTH_TOKEN", errors, "Twilio"),
    fromNumber,
    messagingServiceSid,
  };
}

function loadExotelConfig(
  env: Environment,
  errors: string[],
  base: { timeoutMs: number; messageTemplate: string },
): ExotelConfig {
  const subdomain =
    readValue(env, "AUTH_SMS_EXOTEL_SUBDOMAIN") ?? DEFAULT_EXOTEL_SUBDOMAIN;

  if (!/^(?:[a-z0-9-]+\.)+exotel\.com$/i.test(subdomain)) {
    errors.push(
      "AUTH_SMS_EXOTEL_SUBDOMAIN must be an Exotel API hostname such as api.exotel.com.",
    );
  }

  return {
    provider: "exotel",
    ...base,
    accountSid: required(env, "AUTH_SMS_EXOTEL_ACCOUNT_SID", errors, "Exotel"),
    apiKey: required(env, "AUTH_SMS_EXOTEL_API_KEY", errors, "Exotel"),
    apiToken: required(env, "AUTH_SMS_EXOTEL_API_TOKEN", errors, "Exotel"),
    subdomain: subdomain.toLowerCase(),
    senderId: required(env, "AUTH_SMS_EXOTEL_SENDER_ID", errors, "Exotel"),
    dltEntityId: required(
      env,
      "AUTH_SMS_EXOTEL_DLT_ENTITY_ID",
      errors,
      "Exotel",
    ),
    dltTemplateId: required(
      env,
      "AUTH_SMS_EXOTEL_DLT_TEMPLATE_ID",
      errors,
      "Exotel",
    ),
  };
}

/**
 * Parses and validates the selected SMS provider. Errors name only environment
 * variables and never echo configured values, so a configuration check can be
 * run in a trusted shell without printing credentials.
 */
export function loadSmsConfig(env: Environment = process.env): SmsConfigResult {
  const errors: string[] = [];
  const provider = readProviderName(env, errors);

  if (!provider) {
    return { ok: false, errors };
  }

  const timeoutMs = readTimeout(env, errors);

  let config: SmsConfig;

  switch (provider) {
    case "msg91":
      config = loadMsg91Config(env, errors, { timeoutMs });
      break;
    case "twilio":
      config = loadTwilioConfig(env, errors, {
        timeoutMs,
        messageTemplate: readMessageTemplate(env, errors),
      });
      break;
    case "exotel":
      config = loadExotelConfig(env, errors, {
        timeoutMs,
        messageTemplate: readMessageTemplate(env, errors),
      });
      break;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, config };
}
