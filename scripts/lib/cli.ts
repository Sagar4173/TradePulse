export type ParsedArgs = Map<string, string[]>;

export function fail(message: string): never {
  throw new Error(message);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];

    if (!raw.startsWith("--")) {
      fail(`Unexpected argument: ${raw}`);
    }

    const [key, inlineValue] = raw.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }

    if (!key || !value || value.startsWith("--")) {
      fail(`Missing value for --${key || "unknown"}.`);
    }

    const existing = args.get(key) ?? [];
    existing.push(value);
    args.set(key, existing);
  }

  return args;
}

export function single(args: ParsedArgs, key: string): string | null {
  const values = args.get(key) ?? [];

  if (values.length > 1) {
    fail(`--${key} may only be supplied once.`);
  }

  return values[0] ?? null;
}

export function many(args: ParsedArgs, key: string): string[] {
  return args.get(key) ?? [];
}
