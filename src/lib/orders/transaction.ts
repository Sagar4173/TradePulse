/**
 * Small transaction helpers shared by order submission and lifecycle changes.
 * Serializable retries are bounded; every operation is safe to replay because
 * callers re-read the row state inside the retried transaction.
 */

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isPrismaErrorCode(error, "P2034") || attempt === maxAttempts) {
        throw error;
      }

      await delay(attempt * 15);
    }
  }

  throw new Error("Unreachable transaction retry state.");
}
