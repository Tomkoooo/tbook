import path from "node:path";
import { fileURLToPath } from "node:url";
import { dbConnect, dbDisconnectAll } from "@tbook/db";
import { listAllOrganizations } from "@tbook/services";
import { CliError } from "./errors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Same convention as scripts/seed-dev-fixtures.ts: load apps/web/.env.local
 * for a local DATABASE_URL, but never override one already set in the
 * environment (so a deliberately exported DATABASE_URL — e.g. pointing at
 * a remote production host — always wins).
 */
function loadDotEnvIfNeeded(): void {
  if (process.env.DATABASE_URL) return;
  try {
    process.loadEnvFile(path.resolve(__dirname, "../../../apps/web/.env.local"));
  } catch {
    // No .env.local — fine if DATABASE_URL arrives some other way (--uri, a real env var).
  }
}

export interface ConnectedDb {
  uri: string;
  dbName: string;
}

export async function connectDb(explicitUri?: string): Promise<ConnectedDb> {
  loadDotEnvIfNeeded();
  const uri = explicitUri ?? process.env.DATABASE_URL;
  if (!uri) {
    throw new CliError(
      "No database to connect to. Pass --uri <mongodb://...>, or set DATABASE_URL " +
        "(apps/web/.env.local is loaded automatically when present).",
    );
  }
  await dbConnect(uri);
  let dbName = "(default)";
  try {
    dbName = new URL(uri).pathname.replace(/^\//, "") || dbName;
  } catch {
    // Non-URL-shaped connection string (rare) — keep the placeholder.
  }
  return { uri, dbName };
}

export { dbDisconnectAll };

export interface ResolvedOrg {
  id: string;
  name: string;
  slug: string;
}

/**
 * Resolves `--org`, which may be an id or a slug, through the service
 * layer only (`listAllOrganizations`, org-service.ts) — this CLI never
 * imports a repository or model to read data the services already expose.
 */
export async function resolveOrganization(idOrSlug: string): Promise<ResolvedOrg> {
  const all = await listAllOrganizations();
  const hit = all.find((org) => org.id === idOrSlug || org.slug === idOrSlug);
  if (!hit) {
    const known = all.map((org) => org.slug).join(", ") || "(none)";
    throw new CliError(`No organization matches "${idOrSlug}". Known slugs: ${known}`);
  }
  return { id: hit.id, name: hit.name, slug: hit.slug };
}
