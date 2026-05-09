/**
 * Next.js instrumentation hook — runs once at server startup. Used to kick off
 * the on-chain event indexer.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startIndexer } = await import("./lib/chain/indexer");
    startIndexer();
  }
}
