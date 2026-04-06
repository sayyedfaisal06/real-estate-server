// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";

import { env, corsOrigins } from "./config";
import { auth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import apiRouter from "./routes/index";
import webhookRouter from "./modules/communications/webhooks.routes";
import { logger } from "./utils/logger";

const app = express();

// ─── Security ─────────────────────────────────
app.use(helmet());
app.set("trust proxy", 1);

// ─── CORS ─────────────────────────────────────
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

// ─── Webhooks (raw body needed for signature verification) ─
app.use("/webhooks", express.urlencoded({ extended: false }), webhookRouter);

// ─── Body parsing ─────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(compression());

// ─── Logging ─────────────────────────────────
app.use(
  morgan("tiny", {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === `/api/${env.API_VERSION}/health`,
  }),
);

// ─── Rate limiting ────────────────────────────
app.use(
  `/api/${env.API_VERSION}`,
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Rate limit per tenant, not per IP
      const authHeader = req.headers.authorization;
      return authHeader ?? req.ip ?? "unknown";
    },
  }),
);

// ─── Better Auth handler ──────────────────────
app.all("/api/auth/*", toNodeHandler(auth));

// ─── API routes ───────────────────────────────
app.use(`/api/${env.API_VERSION}`, apiRouter);

// ─── 404 handler ─────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// ─── Global error handler ─────────────────────
app.use(errorHandler);

export default app;
