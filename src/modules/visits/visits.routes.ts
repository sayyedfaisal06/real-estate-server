// src/modules/visits/visits.routes.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { VisitOutcome } from "../../generated/prisma/client";
import { communicationQueue } from "../../queues";

const router = Router();

const createVisitSchema = z.object({
  leadId: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime(),
});

// ─── GET /visits ──────────────────────────────
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { agentId, projectId, date } = req.query as Record<string, string>;

    const startOfDay = date ? new Date(date) : undefined;
    const endOfDay = date
      ? new Date(new Date(date).setHours(23, 59, 59, 999))
      : undefined;

    const visits = await prisma.siteVisit.findMany({
      where: {
        lead: { tenantId: user.tenantId },
        ...(agentId && { agentId }),
        ...(projectId && { projectId }),
        ...(startOfDay &&
          endOfDay && {
            scheduledAt: { gte: startOfDay, lte: endOfDay },
          }),
        ...(user.role === "AGENT" && { agentId: user.id }),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        project: { select: { id: true, name: true, location: true } },
        agent: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: "asc" },
    });

    return res.json({ success: true, data: visits });
  }),
);

// ─── POST /visits ─────────────────────────────
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = createVisitSchema.parse(req.body);

    const visit = await prisma.siteVisit.create({
      data: {
        ...body,
        scheduledAt: new Date(body.scheduledAt),
        agentId: body.agentId ?? user.id,
      },
      include: {
        lead: { select: { name: true, phone: true } },
        project: { select: { name: true, location: true } },
      },
    });

    // Move lead to VISIT_SCHEDULED stage
    await prisma.lead.update({
      where: { id: body.leadId },
      data: { stage: "VISIT_SCHEDULED" },
    });

    // Send WhatsApp confirmation to lead
    const confirmMsg = `Hi ${visit.lead.name}, your site visit at ${visit.project.name}, ${visit.project.location} is confirmed for ${new Date(body.scheduledAt).toLocaleString("en-IN")}. See you there!`;

    await communicationQueue.add("send", {
      tenantId: user.tenantId,
      leadId: body.leadId,
      channel: "WHATSAPP",
      to: visit.lead.phone,
      content: confirmMsg,
    });

    return res.status(201).json({ success: true, data: visit });
  }),
);

// ─── PATCH /visits/:id/outcome ────────────────
router.patch(
  "/:id/outcome",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { outcome, notes } = z
      .object({
        outcome: z.nativeEnum(VisitOutcome),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const visit = await prisma.siteVisit.findFirst({
      where: { id: req.params.id, lead: { tenantId: user.tenantId } },
    });
    if (!visit)
      return res.status(404).json({ success: false, error: "Visit not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.siteVisit.update({
        where: { id: req.params.id },
        data: { outcome, status: "COMPLETED", notes },
      });

      // Auto-advance lead stage
      const stageMap: Partial<
        Record<VisitOutcome, "VISIT_DONE" | "NEGOTIATION" | "BOOKED">
      > = {
        INTERESTED: "VISIT_DONE",
        NEEDS_FOLLOW_UP: "VISIT_DONE",
        BOOKED_ON_SPOT: "BOOKED",
      };

      const newStage = stageMap[outcome];
      if (newStage) {
        await tx.lead.update({
          where: { id: visit.leadId },
          data: { stage: newStage },
        });
        await tx.pipelineStageLog.create({
          data: { leadId: visit.leadId, toStage: newStage, movedById: user.id },
        });
      }

      return v;
    });

    return res.json({ success: true, data: updated });
  }),
);

export default router;
