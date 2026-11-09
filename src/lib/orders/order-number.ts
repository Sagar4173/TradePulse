/**
 * Human-readable order numbers: `TP-YYYYMMDD-######`.
 *
 * The sequence is allocated by PostgreSQL (`order_number_seq`) inside the same
 * transaction that creates the order, so concurrent submissions cannot receive
 * the same number. The calendar date is always the Asia/Kolkata date, matching
 * the date shown throughout the product.
 */

export const MAX_ORDER_SEQUENCE = 999_999;

const kolkataDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatKolkataDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("A valid order date is required.");
  }

  const parts = kolkataDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not resolve the order date.");
  }

  return `${year}${month}${day}`;
}

export function formatOrderNumber(date: Date, sequence: number): string {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_ORDER_SEQUENCE
  ) {
    throw new Error(
      `Order sequence must be an integer between 1 and ${MAX_ORDER_SEQUENCE}.`,
    );
  }

  return `TP-${formatKolkataDate(date)}-${String(sequence).padStart(6, "0")}`;
}
