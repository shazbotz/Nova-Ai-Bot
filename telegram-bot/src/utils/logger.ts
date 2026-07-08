import winston from "winston";
import path from "path";
import fs from "fs";
import { Writable } from "stream";
import { SystemLog } from "../memory/models";

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ── Mirror warn/error/info logs into MongoDB (SystemLog) ──────────────────────
// The admin dashboard's "Logs" page and "Recent Logs" widget query the
// SystemLog collection, but nothing previously wrote to it. We tap the
// already-JSON-formatted log line here and persist it, without ever letting a
// DB hiccup take down logging itself.
const DB_LOG_LEVELS = new Set(["info", "warn", "error"]);

function persistToDatabase(raw: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // not a JSON log line, ignore
  }

  const level = parsed.level as string;
  if (!DB_LOG_LEVELS.has(level)) return;
  const dbLevel = level as "info" | "warn" | "error";

  const { level: _level, message, timestamp, ...meta } = parsed;

  SystemLog.create({
    level: dbLevel,
    message: typeof message === "string" ? message : JSON.stringify(message),
    meta: Object.keys(meta).length ? meta : undefined,
    timestamp: timestamp ? new Date(timestamp as string) : new Date(),
  }).catch(() => {
    // Swallow DB logging failures — logging must never crash the app.
  });
}

const dbLogStream = new Writable({
  write(chunk: Buffer, _enc, callback) {
    persistToDatabase(chunk.toString());
    callback();
  },
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.Stream({ stream: dbLogStream }),
  ],
});
