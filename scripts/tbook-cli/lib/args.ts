import { CliError } from "./errors";

/**
 * Every option is a `--flag` or `--flag value`; a flag given more than
 * once is kept as a list (used by `--set`, `--confirm-field`, ...). No
 * positional arguments — `<entity> <action>` are consumed by cli.ts before
 * this ever runs, so everything left is unambiguously a flag.
 */
export interface Flags {
  get(name: string): string | undefined;
  getAll(name: string): string[];
  has(name: string): boolean;
  /** True unless the flag is absent or explicitly `--flag=false`. */
  bool(name: string): boolean;
}

export function parseArgs(argv: string[]): Flags {
  const map = new Map<string, string[]>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) {
      throw new CliError(`Unexpected argument "${token}" — every option must be a --flag.`);
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");

    let name: string;
    let value: string;
    if (eq !== -1) {
      name = body.slice(0, eq);
      value = body.slice(eq + 1);
    } else {
      name = body;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        value = "true";
      } else {
        value = next;
        i += 1;
      }
    }

    const list = map.get(name) ?? [];
    list.push(value);
    map.set(name, list);
  }

  return {
    get(name) {
      const list = map.get(name);
      return list ? list[list.length - 1] : undefined;
    },
    getAll(name) {
      return map.get(name) ?? [];
    },
    has(name) {
      return map.has(name);
    },
    bool(name) {
      const list = map.get(name);
      return list !== undefined && list[list.length - 1] !== "false";
    },
  };
}

export function requireFlag(flags: Flags, name: string): string {
  const value = flags.get(name);
  if (!value) throw new CliError(`Missing required --${name}.`);
  return value;
}
