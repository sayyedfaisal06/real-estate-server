import app from "./app";
import { env } from "./config";
import { connectDB, disconnectDB } from "./config/database";
import { redis } from "./config/redis";
import { scheduleFollowUps } from "./queues";
import { logger } from "./utils/logger";

let followUpInterval: NodeJS.Timeout;

async function start() {
  // 🚀 Start HTTP server FIRST (important for Railway)
  const PORT = process.env.PORT || env.PORT || "0.0.0.0";

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Propflow API running on port ${PORT} [${env.NODE_ENV}]`);
  });

  // 🔌 Connect DB (non-blocking)
  connectDB()
    .then(() => logger.info("✅ Database connected"))
    .catch((err) => logger.error("❌ DB connection failed", err));

  // 🔌 Connect Redis safely
  redis
    .connect?.()
    .then(() => logger.info("✅ Redis connected"))
    .catch((err) => logger.warn("⚠️ Redis failed, continuing...", err));

  // ⏱️ Follow-up scheduler
  followUpInterval = setInterval(async () => {
    try {
      await scheduleFollowUps();
    } catch (err) {
      logger.error("Follow-up scheduler error", { err });
    }
  }, 60_000);

  // ─── Graceful shutdown ───────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);

    clearInterval(followUpInterval);

    server.close(async () => {
      try {
        await disconnectDB();
        await redis.quit();
      } catch (e) {
        logger.error("Shutdown error", e);
      }

      logger.info("Server shut down cleanly");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) =>
    logger.error("Unhandled promise rejection", reason),
  );
}

start().catch((err) => {
  logger.error("Failed to start server", err);
  process.exit(1);
});
