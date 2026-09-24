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

export async function dbDisconnectAll(): Promise<void> {
  const cache = getCache();
  await Promise.all(
    Array.from(cache.values()).map(async (entry) => {
      if (entry.conn) await entry.conn.disconnect();
    }),
  );
  cache.clear();
}
