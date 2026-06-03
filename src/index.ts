import { AppDb } from "./db.js";
import { DeviceSyncService } from "./deviceSync.js";
import { Logger } from "./logger.js";
import { SyncService } from "./sync/syncService.js";
import { createServer } from "./web/server.js";
import { config } from "./config.js";
import { seedDemoData } from "./demoSeed.js";
import { loadChannelSources } from "./channelSource.js";

const logger = new Logger();
const db = new AppDb();
seedDemoData(db);
db.reconcileChannelSources(loadChannelSources());
const interruptedRuns = db.reconcileInterruptedRuns("Interrupted by server shutdown or restart.");
if (interruptedRuns > 0) {
  logger.warn(`reconciled ${interruptedRuns} interrupted sync run${interruptedRuns === 1 ? "" : "s"} on startup`);
}
const deviceSyncService = new DeviceSyncService();
const syncService = new SyncService(db, logger, deviceSyncService);
const app = createServer(db, syncService, deviceSyncService, logger);

app.listen(config.port, config.host, () => {
  logger.info(`server listening on http://${config.host}:${config.port}`);
});
