// The fault boundary is deliberately small so cleanup paths can be tested without Docker.
export async function databaseOutage({ stop, start, ready, hold, observe, log }) {
  let needsRestore = false;
  try {
    // A failed/aborted stop command can still have stopped the container.
    needsRestore = true;
    log('FAULT docker stop local-test-db');
    await stop();
    log('DB_STOPPED');
    await hold();
    log('RESTORE docker start local-test-db');
    await start();
    await ready();
    needsRestore = false;
    log('DB_READY');
    await observe();
    log('RECOVERY_OBSERVATION_COMPLETE');
  } finally {
    if (needsRestore) {
      // Evidence storage failure must not prevent restoration.
      try { log('RESTORE docker start local-test-db (cleanup)'); }
      finally { await start(); await ready(); }
      log('DB_RESTORED_AFTER_ABORT');
    }
  }
}
