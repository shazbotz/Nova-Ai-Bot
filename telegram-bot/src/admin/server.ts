import express from "express";
import session from "express-session";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";
import { adminRouter } from "./routes";
import { apiRouter } from "../api/routes";

export function createAdminServer(): express.Application {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, "public")));

  app.use(
    session({
      secret: config.admin.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
    })
  );

  // ── Mini App API ─────────────────────────────────────────────────────────────
  app.use("/api", apiRouter);

  // ── Mini App static files (production build) ─────────────────────────────────
  const miniAppDist = path.join(__dirname, "../../../mini-app/dist");
  app.use("/app", express.static(miniAppDist));
  app.get("/app/*", (_req, res) => {
    res.sendFile(path.join(miniAppDist, "index.html"), (err) => {
      if (err) res.status(404).send("Mini App not built yet. Run: cd artifacts/mini-app && npm run build");
    });
  });

  // ── Admin panel ──────────────────────────────────────────────────────────────
  app.use("/admin", adminRouter);

  app.get("/", (_req, res) => res.redirect("/admin"));
  app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date() }));

  return app;
}
