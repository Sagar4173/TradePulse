export function renderSmsMessage(
  template: string,
  code: string,
  ttlSeconds: number,
): string {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));

  return template
    .split("{code}")
    .join(code)
    .split("{minutes}")
    .join(String(minutes));
}
