import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      keyLength,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * A six-digit code has low entropy, so OTPs are stored with a per-challenge
 * scrypt salt instead of a bare hash. Raw codes never reach the database.
 */
export async function hashOtpCode(code: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derivedKey = await scrypt(code, salt, SCRYPT_KEY_LENGTH);

  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyOtpCodeHash(
  code: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = storedHash.split("$");

  if (algorithm !== "scrypt" || !saltValue || !hashValue) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");

    if (salt.length !== SCRYPT_SALT_LENGTH || expected.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actual = await scrypt(code, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
