import { SmsProviderError } from "./errors";
import type { SmsProviderDeps } from "./types";

const MAX_ATTEMPTS = 2;
const MAX_RETRY_DELAY_MS = 2_000;

export type SmsHttpRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type SmsHttpResponse = {
  status: number;
  body: string;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function httpError(status: number): SmsProviderError {
  if (status === 401 || status === 403) {
    return new SmsProviderError(
      "authentication",
      "The SMS provider rejected the configured credentials.",
      { status },
    );
  }

  if (status === 408) {
    return new SmsProviderError(
      "timeout",
      "The SMS provider did not answer in time.",
      { status },
    );
  }

  if (status === 429) {
    return new SmsProviderError(
      "rate_limited",
      "The SMS provider is temporarily limiting requests.",
      { status },
    );
  }

  if (status >= 500) {
    return new SmsProviderError(
      "server",
      "The SMS provider returned a server error.",
      { status },
    );
  }

  if (status === 400 || status === 404 || status === 422) {
    return new SmsProviderError(
      "rejected",
      "The SMS provider rejected the message request.",
      { status },
    );
  }

  return new SmsProviderError(
    "http",
    "The SMS provider returned an unexpected response.",
    { status },
  );
}

/**
 * Returns the retry delay in milliseconds, or null when the provider did not
 * give a parseable wait or asked for a wait longer than this request can
 * reasonably block the sign-in flow.
 */
function retryDelay(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    const milliseconds = Math.round(seconds * 1_000);
    return milliseconds <= MAX_RETRY_DELAY_MS ? milliseconds : null;
  }

  const date = Date.parse(header);

  if (Number.isNaN(date)) {
    return null;
  }

  const milliseconds = date - Date.now();
  return milliseconds <= MAX_RETRY_DELAY_MS ? Math.max(0, milliseconds) : null;
}

/**
 * Sends one provider request with a hard timeout.
 *
 * Retry policy is deliberately narrow: only HTTP 429 is retried, once, and only
 * when a parseable Retry-After header asks for a wait of two seconds or less.
 * Timeouts, network failures, 5xx responses, authentication failures, malformed
 * responses, and 429 responses without a usable Retry-After are never retried
 * because the provider may already have accepted the message.
 */
export async function postSmsRequest(
  request: SmsHttpRequest,
  deps: SmsProviderDeps = {},
): Promise<SmsHttpResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        // A redirect can replay the OTP body and provider credentials to a
        // host that was never configured. Fail closed instead of following it.
        redirect: "error",
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new SmsProviderError(
          "timeout",
          "The SMS provider request timed out.",
        );
      }

      throw new SmsProviderError(
        "network",
        "The SMS provider request failed before a response was received.",
      );
    }

    let body: string;

    try {
      body = await response.text();
    } catch {
      throw new SmsProviderError(
        "network",
        "The SMS provider response could not be read.",
      );
    }

    if (response.ok) {
      return { status: response.status, body };
    }

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const delay = retryDelay(response.headers.get("retry-after"));

      if (delay !== null) {
        await sleep(delay);
        continue;
      }
    }

    throw httpError(response.status);
  }

  throw new SmsProviderError(
    "rate_limited",
    "The SMS provider is temporarily limiting requests.",
  );
}
