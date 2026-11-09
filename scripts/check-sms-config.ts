import "dotenv/config";

import { loadSmsConfig } from "../src/lib/auth/sms/config";

/**
 * Sanitized production configuration check.
 *
 * Prints only the selected provider, timeout, and whether required values are
 * present. It never prints credentials, phone numbers, sender IDs, DLT IDs,
 * message templates, or raw environment values.
 */

const PLACEHOLDER_PATTERN = /replace-with|your[-_]|x{6,}/i;

const placeholderNames = Object.keys(process.env)
  .filter((name) => name.startsWith("AUTH_SMS_"))
  .filter((name) => {
    const value = process.env[name];
    return value !== undefined && PLACEHOLDER_PATTERN.test(value);
  });

const result = loadSmsConfig(process.env);

if (!result.ok) {
  console.error("SMS configuration is incomplete:");
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  console.error(
    "Set the variables in a trusted environment. Never commit real credentials.",
  );
  process.exitCode = 1;
} else if (placeholderNames.length > 0) {
  console.error("SMS configuration still contains example placeholder values:");
  for (const name of placeholderNames) {
    console.error(`- ${name}`);
  }
  console.error("Replace the placeholders before enabling SMS delivery.");
  process.exitCode = 1;
} else {
  const config = result.config;

  console.log(`SMS provider: ${config.provider}`);
  console.log(`Request timeout: ${config.timeoutMs} ms`);
  console.log("Credentials: present");
  console.log("Configuration shape: valid");

  if (config.provider === "msg91") {
    console.log("OTP template ID: present");
  } else {
    console.log("Message template: present");
  }

  if (config.provider === "twilio") {
    console.log(
      `Sender mode: ${
        config.messagingServiceSid ? "Messaging Service SID" : "From number"
      }`,
    );
  }

  if (config.provider === "exotel") {
    console.log(`API subdomain: ${config.subdomain}`);
    console.log("DLT entity and template: present");
  }

  console.log(
    "Presence checks do not prove provider authentication or DLT approval. Live delivery still requires an active provider account, approved DLT registration where required, and reachable phone numbers.",
  );
}
