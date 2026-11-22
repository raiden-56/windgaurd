import type { PGlite, Transaction } from '@electric-sql/pglite';

/**
 * PGlite has a single connection. On the server, a query issued outside an open interactive
 * transaction (e.g. a settings lookup inside an import row) simply uses another pooled
 * connection; here it would wait for the transaction's lock until Prisma's 5 s timeout.
 * This wrapper runs such queries on the open transaction instead.
 */
export function singleConnectionClient(pg: PGlite): PGlite {
  let active: Transaction | null = null;
  return new Proxy(pg, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (...args: Parameters<PGlite['query']>) => (active ?? target).query(...args);
      }
      if (prop === 'transaction') {
        return <T>(fn: (tx: Transaction) => Promise<T>) =>
          target.transaction(async (tx) => {
            active = tx;
            try {
              return await fn(tx);
            } finally {
              if (active === tx) active = null;
            }
          });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
