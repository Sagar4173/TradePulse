type DecimalLike = { toString(): string } | string | number;

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function formatInr(value: DecimalLike): string {
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return inrFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatDate(value: Date | string): string {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);

  return (
    parts
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "TP"
  );
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
