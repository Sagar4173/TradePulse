# SMS authentication operations

TradePulse signs users in with a phone OTP. The application remains the owner of
the entire verification lifecycle: it generates a cryptographically random
six-digit code, stores only a scrypt hash, enforces expiry, attempt limits,
resend cooldowns, per-phone and per-IP rate limits, consumes a code exactly
once, and issues a database-backed session. An SMS provider is used only to
deliver the code.

Production fails closed. If no complete SMS configuration is present, OTP
requests return the generic "temporarily unavailable" result and no challenge is
usable. Local development can keep using the existing development OTP display,
which requires `AUTH_DEV_OTP_ENABLED=true` and a verified non-production database
target.

## Supported providers

| Provider | Fit | Configuration | Notes |
| --- | --- | --- | --- |
| MSG91 SendOTP | Recommended for an India-first deployment | `AUTH_SMS_MSG91_AUTH_KEY`, `AUTH_SMS_MSG91_TEMPLATE_ID` | Uses MSG91's OTP endpoint with an app-generated `otp`; the dashboard template uses the OTP variable and must be DLT-approved. |
| Twilio Programmable Messaging | Good international fallback | `AUTH_SMS_TWILIO_ACCOUNT_SID`, `AUTH_SMS_TWILIO_AUTH_TOKEN`, and one of `AUTH_SMS_TWILIO_FROM_NUMBER` or `AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID` | Uses the Messages API, not Twilio Verify. India DLT registration is required on the sender. Trial accounts can only send to verified recipients. |
| Exotel SMS | India DLT-native alternative | `AUTH_SMS_EXOTEL_ACCOUNT_SID`, `AUTH_SMS_EXOTEL_API_KEY`, `AUTH_SMS_EXOTEL_API_TOKEN`, `AUTH_SMS_EXOTEL_SENDER_ID`, `AUTH_SMS_EXOTEL_DLT_ENTITY_ID`, `AUTH_SMS_EXOTEL_DLT_TEMPLATE_ID` | Sends `SmsType=transactional` with `Priority=high`; the message body must exactly match the approved DLT template. |

A provider response means the message was accepted, not that the handset
received it. TradePulse does not currently process delivery-status webhooks, so
delivery reporting remains a provider-dashboard operation.

## Selection rules

1. In production, only a complete SMS provider configuration is accepted. The
   development OTP flag is ignored.
2. Outside production, a verified `AUTH_DEV_OTP_ENABLED` development target
   takes precedence over SMS, so local work never sends real texts.
3. Outside production, if `AUTH_DEV_OTP_ENABLED=true` but the database target
   cannot be verified as non-production, selection fails closed instead of
   falling through to a real SMS provider.
4. Outside production with development OTP disabled, a configured SMS provider
   is used.
5. Any missing, unknown, or invalid configuration selects the unavailable
   provider and fails closed.

Run the sanitized check in the target environment:

```bash
npm run auth:sms-check
```

It prints the provider, timeout, and presence of required sections. It never
prints credentials, phone numbers, sender IDs, DLT identifiers, templates, or
raw environment values. It also rejects the example placeholder values. A
successful check proves only that the configuration shape is valid, not that
the provider will authenticate or that DLT approval is in place.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_SMS_PROVIDER` | Yes for SMS | none | `msg91`, `twilio`, or `exotel`. |
| `AUTH_SMS_TIMEOUT_MS` | No | `8000` | One provider attempt timeout, bounded to 1000-20000 ms. |
| `AUTH_SMS_MESSAGE_TEMPLATE` | No | built-in English template | Body for Twilio and Exotel. Must contain `{code}`; `{minutes}` is replaced with the challenge TTL in whole minutes. The final text must match the approved DLT template exactly. MSG91 uses its dashboard template instead. |
| `AUTH_SMS_MSG91_AUTH_KEY` | MSG91 | none | MSG91 auth key. |
| `AUTH_SMS_MSG91_TEMPLATE_ID` | MSG91 | none | MSG91 OTP template identifier. |
| `AUTH_SMS_TWILIO_ACCOUNT_SID` | Twilio | none | Account SID used in the Messages API path and Basic auth username. |
| `AUTH_SMS_TWILIO_AUTH_TOKEN` | Twilio | none | Basic auth password. |
| `AUTH_SMS_TWILIO_FROM_NUMBER` | Twilio, unless using a Messaging Service | none | E.164 sender number. |
| `AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID` | Twilio, unless using a From number | none | Messaging Service SID. Configure exactly one sender mode. |
| `AUTH_SMS_EXOTEL_ACCOUNT_SID` | Exotel | none | Account SID used in the API path. |
| `AUTH_SMS_EXOTEL_API_KEY` | Exotel | none | Basic auth username. |
| `AUTH_SMS_EXOTEL_API_TOKEN` | Exotel | none | Basic auth password. |
| `AUTH_SMS_EXOTEL_SUBDOMAIN` | No | `api.exotel.com` | Exotel API host. Mumbai uses `api.in.exotel.com`. |
| `AUTH_SMS_EXOTEL_SENDER_ID` | Exotel | none | DLT-approved sender ID or ExoPhone. |
| `AUTH_SMS_EXOTEL_DLT_ENTITY_ID` | Exotel | none | DLT entity registration ID. |
| `AUTH_SMS_EXOTEL_DLT_TEMPLATE_ID` | Exotel | none | DLT-approved content template ID. |

Never commit populated values. In production, set them in the deployment
platform's encrypted environment configuration, not in `.env.example` or a
tracked file.

## Provider setup

### MSG91

1. Create an MSG91 account and obtain the auth key.
2. Register the India DLT entity, sender/header, and OTP content template.
3. Create an OTP template in MSG91 using the OTP variable, and copy its template
   identifier.
4. Set `AUTH_SMS_PROVIDER=msg91`, `AUTH_SMS_MSG91_AUTH_KEY`, and
   `AUTH_SMS_MSG91_TEMPLATE_ID`.
5. Run `npm run auth:sms-check`.

The adapter posts to `https://control.msg91.com/api/v5/otp` with the `authkey`
header and JSON fields `template_id`, `mobile`, `otp`, and `otp_expiry`.
`otp_expiry` is derived from `AUTH_OTP_TTL_SECONDS` and sent in minutes. MSG91
can return HTTP 200 with an application error, so the adapter requires an
explicit success type in the response body.

Official references:

- <https://docs.msg91.com/otp/sendotp>
- <https://msg91.com/help/sendotp/where-to-find-the-sendotp-api-how-to-get-template-id>

### Twilio

1. Obtain the Account SID and auth token.
2. Register an Indian sender and complete DLT registration where required.
3. Choose either a From number or a Messaging Service SID.
4. Set the Twilio variables and `AUTH_SMS_PROVIDER=twilio`.
5. If using a trial account, verify the destination number first.
6. Run `npm run auth:sms-check`.

The adapter posts form-encoded `To`, `Body`, and either `From` or
`MessagingServiceSid` to the Messages resource under the account. It does not use
Twilio Verify, so Twilio never generates or validates the TradePulse code.

Official references:

- <https://www.twilio.com/docs/messaging/api/message-resource>
- <https://www.twilio.com/docs/messaging/services>

### Exotel

1. Obtain the account SID, API key, and API token.
2. Register the DLT entity, sender/header, and transactional content template.
3. Set all Exotel variables, including both DLT identifiers.
4. Set `AUTH_SMS_MESSAGE_TEMPLATE` to the approved template text with `{code}`
   and, if the approved template contains the validity period, `{minutes}`.
5. Set `AUTH_SMS_PROVIDER=exotel`.
6. Run `npm run auth:sms-check`.

The adapter posts form fields `From`, `To`, `Body`, `DltEntityId`,
`DltTemplateId`, `SmsType=transactional`, and `Priority=high` to
`https://<subdomain>/v1/Accounts/<account_sid>/Sms/send`. The final body must
match the approved template exactly; a mismatch can be rejected or classified
as promotional by the operator.

Official references:

- <https://developer.exotel.com/docs/sms-api/api-reference/send-sms>
- <https://developer.exotel.com/docs/sms-support/sms-templates>

## Delivery behavior

- **Timeout:** each attempt has a hard deadline (`AUTH_SMS_TIMEOUT_MS`, default
  8 seconds). The worst case is two attempts plus a short retry wait, so keep
  `AUTH_SMS_TIMEOUT_MS` below the deployment platform's function limit.
- **Retry:** only HTTP 429 is retried, once, and only when a parseable
  `Retry-After` header asks for a wait of 2 seconds or less. Timeouts, network
  failures, 5xx responses, authentication failures, malformed responses, and
  429 responses without a usable `Retry-After` are never retried because the
  provider may already have accepted the message.
- **Redirects:** provider requests reject HTTP redirects so an OTP body or
  credential header cannot be replayed to an unconfigured host.
- **Duplicate protection:** the database admission lock and resend cooldown
  allow at most one OTP request per phone per cooldown window. A second request
  is rejected before a new code is generated. No cross-instance state is
  required beyond PostgreSQL.
- **Failure handling:** a provider failure marks the reservation `FAILED` and
  the challenge unusable. The request still counts toward the rate-limit window,
  and the user receives only a generic temporary-unavailability message.
- **Logging:** the application does not log OTPs, provider credentials, request
  bodies, or provider response bodies. Normalized errors carry a category and
  optional HTTP status only.

## Verification

Before enabling production SMS:

```bash
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run build
npm run auth:sms-check
```

Integration tests require an explicit disposable PostgreSQL target supplied
through `TRADEPULSE_TEST_DATABASE_ADMIN_URL`; they must not use `neondb`,
production records, or production-matching targets. A Neon target is accepted
only for the explicitly allowlisted `tradepulse_test` database using a direct,
non-pooled endpoint. That database shares the existing project's compute with
production unless a separate Neon project/branch or an explicitly denied
production host is used. A real SMS delivery check additionally requires
provider credentials, an approved sender, DLT approval, and explicit
authorization to configure the target environment.

## Limitations

- No delivery webhook or per-message status tracking is implemented.
- Real provider delivery has not been verified without production credentials
  and DLT approval.
- Twilio Verify and MSG91's server-side OTP verification are intentionally not
  used; verification remains local and hash-based.
