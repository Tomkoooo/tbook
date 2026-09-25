import { MongoClient } from "mongodb";

/**
 * Native-driver client for @auth/mongodb-adapter, which requires the raw
 * `mongodb` driver rather than Mongoose. Separate cache from
 * connection.ts's Mongoose singleton, but points at the same DATABASE_URL —
 * both talk to the same database, just via different client libraries.
 *
 * Pinned to mongodb@^7.5.0 (not the adapter's own peer-declared `^6`,
 * which the legacy repo also pins) because mongoose@9 has a hard runtime
 * dependency on mongodb@~7.6 — two different major versions of the driver
 * in one workspace caused real TypeScript structural type conflicts
 * (`MongoClient` from one install isn't assignable to `MongoClient` from
 * the other). The MongoDB wire protocol/server compatibility is unaffected
 * either way; this is purely a client-library version choice, unrelated to
 * data compatibility. `@auth/mongodb-adapter`'s actual CRUD usage against
 * the driver is stable across v6/v7, verified by this repo's own
 * legacy-account-compatibility integration test.
 */

const globalForMongoClient = globalThis as unknown as {
  __tbookMongoClientCache?: Map<string, Promise<MongoClient>>;
};

function getCache(): Map<string, Promise<MongoClient>> {
  if (!globalForMongoClient.__tbookMongoClientCache) {
    globalForMongoClient.__tbookMongoClientCache = new Map();
  }
  return globalForMongoClient.__tbookMongoClientCache;
}

export function getMongoClient(uri: string): Promise<MongoClient> {
  const cache = getCache();
  let promise = cache.get(uri);
  if (!promise) {
    promise = new MongoClient(uri).connect();
    cache.set(uri, promise);
  }
  return promise;
}
