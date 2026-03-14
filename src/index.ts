import { AppDb } from "./db.js";
import { Logger } from "./logger.js";
import { SyncService } from "./sync/syncService.js";
import { createServer } from "./web/server.js";
import { config } from "./config.js";

const logger = new Logger();
const db = new AppDb();
const syncService = new SyncService(db, logger);
const app = createServer(db, syncService, logger);

app.listen(config.port, config.host, () => {
  logger.info(`server listening on http://${config.host}:${config.port}`);
});

