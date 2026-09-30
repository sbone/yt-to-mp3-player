import { createServer as createHttpServer } from "node:http";
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

const server = createHttpServer(app);
if (process.env.DEV_MODE === "1") {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: { server } }
  });
  app.use(vite.middlewares);
}

server.listen(config.port, config.host, () => {
  const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;
  const binding = config.host === "0.0.0.0" ? " (listening on all IPv4 interfaces)" : "";
  logger.info(`server listening on http://${displayHost}:${config.port}${binding}`);
});
