import { appendFileSync } from "node:fs";
import { config } from "./config.js";

type Level = "info" | "warn" | "error";

export class Logger {
  log(level: Level, message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
    appendFileSync(config.logPath, line, { encoding: "utf8" });
    if (level === "error") {
      console.error(line.trim());
      return;
    }
    console.log(line.trim());
  }

  info(message: string): void {
    this.log("info", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }
}

