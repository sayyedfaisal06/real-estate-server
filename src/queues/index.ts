// src/queues/index.ts
import { Queue, Worker, QueueEvents } from "bullmq";
import { redisForBull } from "../config/redis";
import { scoreLead } from "../services/ai.service";
import { sendMessage } from "../services/communication.service";
import { prisma } from "../config/database";
import { logger } from "../utils/logger";
import {
  AIScoreJobPayload,
  CommunicationJobPayload,
  FollowUpJobPayload,
} from "../types";

const queueOpts = { connection: redisForBull };

// ─── Queue definitions ────────────────────────
export const aiScoreQueue = new Queue<AIScoreJobPayload>("ai-score", queueOpts);
export const communicationQueue = new Queue<CommunicationJobPayload>(
  "communication",
  queueOpts,
);
export const followUpQueue = new Queue<FollowUpJobPayload>(
  "follow-up",
  queueOpts,
);

// ─── Workers ──────────────────────────────────

// AI scoring worker
new Worker<AIScoreJobPayload>(
  "ai-score",
  async (job) => {
    const { tenantId, leadId } = job.data;
    await scoreLead(tenantId, leadId);
  },
  { ...queueOpts, concurrency: 5 },
);

// Communication sender worker
new Worker<CommunicationJobPayload>(
  "communication",
  async (job) => {
    const { tenantId, leadId, channel, to, content, mediaUrl } = job.data;
    if (channel === "WHATSAPP" || channel === "SMS") {
      await sendMessage({ tenantId, leadId, to, content, channel, mediaUrl });
    }
    // Email channel handled separately via Resend
  },
  { ...queueOpts, concurrency: 10 },
);

// Follow-up task executor
new Worker<FollowUpJobPayload>(
  "follow-up",
  async (job) => {
    const { taskId, tenantId, leadId, channel, content } = job.data;

    const task = await prisma.followUpTask.findFirst({
      where: { id: taskId, completed: false },
      include: { lead: { select: { phone: true } } },
    });

    if (!task || !task.lead.phone) {
      logger.warn("Follow-up task not found or lead has no phone", { taskId });
      return;
    }

    if (channel === "WHATSAPP" || channel === "SMS") {
      await communicationQueue.add("send", {
        tenantId,
        leadId,
        channel: channel as "WHATSAPP" | "SMS",
        to: task.lead.phone,
        content,
      });
    }

    await prisma.followUpTask.update({
      where: { id: taskId },
      data: { completed: true, completedAt: new Date() },
    });
  },
  { ...queueOpts, concurrency: 5 },
);

// ─── Queue event logging ──────────────────────
const logQueueEvents = (queue: Queue) => {
  const events = new QueueEvents(queue.name, queueOpts);
  events.on("failed", ({ jobId, failedReason }) =>
    logger.error("Job failed", { queue: queue.name, jobId, failedReason }),
  );
  events.on("completed", ({ jobId }) =>
    logger.debug("Job completed", { queue: queue.name, jobId }),
  );
};

logQueueEvents(aiScoreQueue);
logQueueEvents(communicationQueue);
logQueueEvents(followUpQueue);

// ─── Schedule follow-up tasks (runs every minute) ─
export async function scheduleFollowUps() {
  const due = await prisma.followUpTask.findMany({
    where: {
      completed: false,
      dueAt: { lte: new Date() },
    },
    include: { lead: { select: { phone: true } } },
    take: 100,
  });

  for (const task of due) {
    await followUpQueue.add(
      "execute",
      {
        taskId: task.id,
        tenantId: task.tenantId,
        leadId: task.leadId,
        channel: task.channel ?? "WHATSAPP",
        content: task.content,
      },
      { jobId: task.id }, // deduplication
    );
  }

  if (due.length > 0) {
    logger.info("Follow-up tasks queued", { count: due.length });
  }
}
