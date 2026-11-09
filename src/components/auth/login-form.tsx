"use client";

import {
  ArrowRight,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INITIAL_REQUEST_OTP_STATE,
  INITIAL_VERIFY_OTP_STATE,
} from "@/lib/auth/action-types";
import {
  requestOtpAction,
  verifyOtpAction,
} from "@/lib/auth/actions";
import { maskPhone } from "@/lib/auth/phone";
import { safeNextPath } from "@/lib/auth/redirect";

function useClock(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

function secondsRemaining(
  target: number | null | undefined,
  now: number | null,
): number | null {
  if (!target || now === null) {
    return null;
  }

  return Math.max(0, Math.ceil((target - now) / 1_000));
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [requestState, requestAction, requestPending] = useActionState(
    requestOtpAction,
    INITIAL_REQUEST_OTP_STATE,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyOtpAction,
    INITIAL_VERIFY_OTP_STATE,
  );
  const [dismissedChallengeId, setDismissedChallengeId] = useState<
    string | null
  >(null);
  const now = useClock();

  const requestedChallenge =
    requestState.status === "sent" && requestState.challengeId
      ? {
          id: requestState.challengeId,
          phone: requestState.phone ?? "",
          devCode: requestState.devCode,
          resendAt: requestState.resendAt,
          expiresAt: requestState.expiresAt,
        }
      : null;
  const challenge =
    requestedChallenge && requestedChallenge.id !== dismissedChallengeId
      ? requestedChallenge
      : null;

  const resendSeconds = secondsRemaining(challenge?.resendAt, now);
  const expirySeconds = secondsRemaining(challenge?.expiresAt, now);
  const requestError =
    requestState.status === "error" ? requestState.message : "";
  const verifyError =
    challenge &&
    verifyState.status === "error" &&
    verifyState.challengeId === challenge.id
      ? verifyState.message
      : "";
  const errorMessage = verifyError || requestError;

  return (
    <div className="w-full">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-xs font-medium text-primary">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          Secure phone sign-in
        </span>
        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          {challenge ? "Enter your code" : "Welcome back"}
        </h1>
        <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">
          {challenge
            ? `We sent a 6-digit code to ${maskPhone(challenge.phone)}.`
            : "Sign in with the mobile number linked to your TradePulse account. New verified retailers are created automatically."}
        </p>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-destructive"
        >
          {errorMessage}
        </div>
      ) : null}

      {challenge ? (
        <div className="space-y-5">
          {challenge.devCode ? (
            <div className="rounded-xl border border-accent-foreground/15 bg-accent px-4 py-3 text-sm text-accent-foreground">
              <p className="font-semibold">Local development code</p>
              <p className="mt-1 font-mono text-xl tracking-[0.3em]">
                {challenge.devCode}
              </p>
              <p className="mt-1 text-xs opacity-80">
                Shown only when AUTH_DEV_OTP_ENABLED=true outside production.
              </p>
            </div>
          ) : null}

          <form key={challenge.id} action={verifyAction} className="space-y-4">
            <input type="hidden" name="challengeId" value={challenge.id} />
            <input type="hidden" name="next" value={nextPath} />
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="otp-code">6-digit verification code</Label>
                {expirySeconds !== null && expirySeconds > 0 ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    Expires in {formatCountdown(expirySeconds)}
                  </span>
                ) : null}
              </div>
              <Input
                id="otp-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                aria-invalid={verifyError ? true : undefined}
                placeholder="000000"
                className="h-12 text-center text-xl tracking-[0.45em] tabular-nums"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-11 w-full"
              disabled={verifyPending}
            >
              {verifyPending ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                  Verifying…
                </>
              ) : (
                <>
                  Verify and sign in
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </>
              )}
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <form action={requestAction}>
              <input type="hidden" name="phone" value={challenge.phone} />
              <input type="hidden" name="next" value={nextPath} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={requestPending || (resendSeconds ?? 0) > 0}
              >
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {resendSeconds && resendSeconds > 0
                  ? `Resend in ${resendSeconds}s`
                  : "Resend code"}
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDismissedChallengeId(challenge.id)}
            >
              Change number
            </Button>
          </div>
        </div>
      ) : (
        <form action={requestAction} className="space-y-5">
          <input type="hidden" name="next" value={nextPath} />
          <div className="space-y-2">
            <Label htmlFor="phone">Mobile number</Label>
            <div className="flex h-12 overflow-hidden rounded-lg border border-input bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <span className="flex shrink-0 items-center border-r border-border bg-muted/70 px-3.5 text-sm font-medium">
                +91
              </span>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                aria-describedby="phone-help"
                aria-invalid={requestError ? true : undefined}
                defaultValue={requestState.phone?.slice(3) ?? ""}
                placeholder="98765 43210"
                className="h-full min-w-0 flex-1 rounded-none border-0 text-base shadow-none focus-visible:ring-0"
              />
            </div>
            <p
              id="phone-help"
              className="text-xs leading-5 text-muted-foreground"
            >
              India only. Standard SMS rates may apply.
            </p>
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-11 w-full"
            disabled={requestPending}
          >
            {requestPending ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
                Sending code…
              </>
            ) : (
              <>
                Send verification code
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </>
            )}
          </Button>
        </form>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        <Smartphone aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <p>
          We never reveal whether an account exists. Accounts are protected by
          OTP expiry, attempt limits, and request throttling.
        </p>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          href="/"
          className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to TradePulse
        </Link>
      </p>
    </div>
  );
}
