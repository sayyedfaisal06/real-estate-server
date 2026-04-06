// src/server.ts
import app from "./app";
import { env } from "./config";
import { connectDB, disconnectDB } from "./config/database";
import { redis } from "./config/redis";
import { scheduleFollowUps } from "./queues";
import { logger } from "./utils/logger";

let followUpInterval: NodeJS.Timeout;

async function start() {
  // Connect to DB
  await connectDB();

  // Start HTTP server
  const server = app.listen(env.PORT, () => {
    logger.info(
      `🚀 Propflow API running on port ${env.PORT} [${env.NODE_ENV}]`,
    );
    logger.info(
      `📡 API base: http://localhost:${env.PORT}/api/${env.API_VERSION}`,
    );
  });

  // Follow-up scheduler — runs every 60 seconds
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
      await disconnectDB();
      await redis.quit();
      logger.info("Server shut down cleanly");
      process.exit(0);
    });

    // Force exit after 10s
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
