// src/modules/notifications/followups.routes.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { CommChannel, TaskType } from "../../generated/prisma/client";
import { generateFollowUp } from "../../services/ai.service";

const router = Router();

const createTaskSchema = z.object({
  leadId: z.string().uuid(),
  type: z.nativeEnum(TaskType),
  content: z.string().min(1),
  channel: z.nativeEnum(CommChannel).optional(),
  assignedToId: z.string().uuid().optional(),
  dueAt: z.string().datetime(),
});

// ─── GET /follow-ups ──────────────────────────
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { completed, leadId } = req.query as Record<string, string>;

    const tasks = await prisma.followUpTask.findMany({
      where: {
        tenantId: user.tenantId,
        ...(leadId && { leadId }),
        ...(completed !== undefined && { completed: completed === "true" }),
        ...(user.role === "AGENT" && { assignedToId: user.id }),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, stage: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: [{ completed: "asc" }, { dueAt: "asc" }],
      take: 100,
    });

    return res.json({ success: true, data: tasks });
  }),
);

// ─── POST /follow-ups ─────────────────────────
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = createTaskSchema.parse(req.body);

    const task = await prisma.followUpTask.create({
      data: {
        ...body,
        dueAt: new Date(body.dueAt),
        tenantId: user.tenantId,
        assignedToId: body.assignedToId ?? user.id,
      },
    });

    return res.status(201).json({ success: true, data: task });
  }),
);

// ─── POST /follow-ups/ai-generate ────────────
router.post(
  "/ai-generate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { leadId, channel } = z
      .object({
        leadId: z.string().uuid(),
        channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
      })
      .parse(req.body);

    const content = await generateFollowUp(leadId, user.tenantId, channel);

    // Auto-create the task due in 1 hour
    const task = await prisma.followUpTask.create({
      data: {
        tenantId: user.tenantId,
        leadId,
        assignedToId: user.id,
        type:
          channel === "EMAIL"
            ? "EMAIL"
            : channel === "SMS"
              ? "SMS"
              : "WHATSAPP_MESSAGE",
        channel: channel as CommChannel,
        content,
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    return res.status(201).json({ success: true, data: task });
  }),
);

// ─── PATCH /follow-ups/:id/complete ──────────
router.patch(
  "/:id/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;

    await prisma.followUpTask.updateMany({
      where: { id: req.params.id, tenantId: user.tenantId },
      data: { completed: true, completedAt: new Date() },
    });

    return res.json({ success: true });
  }),
);

export default router;
