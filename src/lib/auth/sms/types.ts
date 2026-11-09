export const SMS_PROVIDER_NAMES = ["msg91", "twilio", "exotel"] as const;

export type SmsProviderName = (typeof SMS_PROVIDER_NAMES)[number];

export const DEFAULT_SMS_TIMEOUT_MS = 8_000;
export const MIN_SMS_TIMEOUT_MS = 1_000;
export const MAX_SMS_TIMEOUT_MS = 20_000;

export const DEFAULT_SMS_MESSAGE_TEMPLATE =
  "Your TradePulse verification code is {code}. It is valid for {minutes} minutes. Do not share this code with anyone.";

type SmsBaseConfig = {
  /**
   * Total time allowed for one provider request attempt. A timeout is never
   * retried because the provider may already have accepted the message.
   */
  timeoutMs: number;
};

type SmsBodyConfig = SmsBaseConfig & {
  /**
   * Free-text message used by providers that accept a body. The placeholders
   * {code} and {minutes} are replaced at send time. The final text must match
   * the approved DLT template exactly.
   */
  messageTemplate: string;
};

export type Msg91Config = SmsBaseConfig & {
  provider: "msg91";
  authKey: string;
  templateId: string;
};

export type TwilioConfig = SmsBodyConfig & {
  provider: "twilio";
  accountSid: string;
  authToken: string;
  fromNumber: string | null;
  messagingServiceSid: string | null;
};

export type ExotelConfig = SmsBodyConfig & {
  provider: "exotel";
  accountSid: string;
  apiKey: string;
  apiToken: string;
  subdomain: string;
  senderId: string;
  dltEntityId: string;
  dltTemplateId: string;
};

export type SmsConfig = Msg91Config | TwilioConfig | ExotelConfig;

export type SmsFetch = (url: string, init: RequestInit) => Promise<Response>;

export type SmsProviderDeps = {
  fetchImpl?: SmsFetch;
  /** Injected in tests so retry timing is deterministic. */
  sleep?: (milliseconds: number) => Promise<void>;
};
