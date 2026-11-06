import "server-only";

import { loadAuthConfig } from "./config";
import {
  generateOtpCode,
  generateSessionToken,
  hashOtpCode,
  hashSessionToken,
  verifyOtpCodeHash,
} from "./crypto";
import { createOtpProvider } from "./providers";
import { createPrismaAuthStore } from "./store-prisma";
import type {
  AuthConfig,
  OtpServiceDeps,
  SessionServiceDeps,
} from "./types";

const store = createPrismaAuthStore();
const config = loadAuthConfig();
const provider = createOtpProvider({
  env: process.env,
  isProduction: config.isProduction,
});

export function getAuthConfig(): AuthConfig {
  return config;
}

export function getOtpServiceDeps(): OtpServiceDeps {
  return {
    store,
    provider,
    config,
    now: () => new Date(),
    generateCode: generateOtpCode,
    generateSessionToken,
    hashOtp: hashOtpCode,
    verifyOtpHash: verifyOtpCodeHash,
    hashToken: hashSessionToken,
  };
}

export function getSessionServiceDeps(): SessionServiceDeps {
  return {
    store,
    now: () => new Date(),
    hashToken: hashSessionToken,
  };
}
