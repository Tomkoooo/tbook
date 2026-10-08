import mongoose from "mongoose";

/**
 * Cached, URI-keyed connection singleton — same shape as the legacy
 * packages/core/src/lib/db.ts. Keying by URI (not a single global) matters
 * because tests spin up a throwaway mongodb-memory-server URI while the app
 * uses DATABASE_URL (must point at the existing `tbook-admin` database for
 * production to stay backwards compatible).
 */

interface CachedConnection {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as unknown as {
  __tbookMongooseCache?: Map<string, CachedConnection>;
};

function getCache(): Map<string, CachedConnection> {
  if (!globalForMongoose.__tbookMongooseCache) {
    globalForMongoose.__tbookMongooseCache = new Map();
  }
  return globalForMongoose.__tbookMongooseCache;
}

export async function dbConnect(uri: string): Promise<typeof mongoose> {
  const cache = getCache();
  const existing = cache.get(uri);
  if (existing?.conn) return existing.conn;

  const entry: CachedConnection = existing ?? { conn: null, promise: null };
  if (!entry.promise) {
    entry.promise = mongoose.connect(uri, { bufferCommands: false });
  }
  cache.set(uri, entry);

  entry.conn = await entry.promise;
  return entry.conn;
}

/**
 * Idempotent "make sure we're connected" guard for the request layer.
 *
 * Mongoose buffers an operation issued before `connect()` has ever been
 * called and then fails it with a "buffering timed out" error after 10s.
 * Nothing about importing a model opens a connection, so every entry point
 * that touches the database has to have gone through a connect first.
 * Until this existed, `/api/health` was the only caller of dbConnect —
 * which meant a freshly started container served buffering-timeout errors
 * on the public v1 API until the Docker healthcheck happened to fire and
 * open the connection as a side effect. That is the kind of bug that looks
 * like "the database is down" and isn't.
 *
 * Safe and cheap to call on every request: dbConnect caches both the
 * connection and the in-flight promise per URI, so concurrent callers at
 * cold start all await the same connect rather than opening N of them.
 */
export async function ensureDbConnection(): Promise<typeof mongoose> {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error("DATABASE_URL is not set");
  return dbConnect(uri);
}

export async function dbDisconnectAll(): Promise<void> {
  const cache = getCache();
  await Promise.all(
    Array.from(cache.values()).map(async (entry) => {
      if (entry.conn) await entry.conn.disconnect();
    }),
  );
  cache.clear();
}
