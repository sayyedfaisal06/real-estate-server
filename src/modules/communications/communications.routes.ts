// src/modules/communications/communications.routes.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler, paginate } from "../../middleware/errorHandler";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { communicationQueue } from "../../queues";
import { generateFollowUp } from "../../services/ai.service";

const router = Router();

const sendMessageSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  content: z.string().min(1),
  mediaUrl: z.string().url().optional(),
});

// ─── GET /communications?leadId= ─────────────
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const { leadId } = req.query as { leadId?: string };
    const { skip, limit, page } = paginate(req.query as Record<string, string>);

    if (!leadId) {
      return res
        .status(400)
        .json({ success: false, error: "leadId is required" });
    }

    const [comms, total] = await Promise.all([
      prisma.communication.findMany({
        where: { tenantId: user.tenantId, leadId },
        orderBy: { sentAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.communication.count({
        where: { tenantId: user.tenantId, leadId },
      }),
    ]);

    return res.json({
      success: true,
      data: comms,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }),
);

// ─── POST /communications/send ────────────────
router.post(
  "/send",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const body = sendMessageSchema.parse(req.body);

    const lead = await prisma.lead.findFirst({
      where: { id: body.leadId, tenantId: user.tenantId, isDeleted: false },
      select: { id: true, phone: true, email: true },
    });

    if (!lead)
      return res.status(404).json({ success: false, error: "Lead not found" });

    await communicationQueue.add("send", {
      tenantId: user.tenantId,
      leadId: lead.id,
      channel: body.channel as "WHATSAPP" | "SMS" | "EMAIL",
      to: body.channel === "EMAIL" ? (lead.email ?? "") : lead.phone,
      content: body.content,
      mediaUrl: body.mediaUrl,
    });

    return res
      .status(202)
      .json({ success: true, message: "Message queued for delivery" });
  }),
);

// ─── POST /communications/generate-followup ──
router.post(
  "/generate-followup",
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
    return res.json({ success: true, data: { content } });
  }),
);

export default router;
