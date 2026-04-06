// src/modules/communications/webhooks.routes.ts
import { Router, Request, Response } from "express";
import twilio from "twilio";
import { env } from "../../config";
import { asyncHandler } from "../../middleware/errorHandler";
import {
  processInboundMessage,
  updateDeliveryStatus,
} from "../../services/communication.service";
import { aiScoreQueue } from "../../queues";
import { logger } from "../../utils/logger";

const router = Router();

// ─── Verify Twilio signature ──────────────────
function validateTwilioSignature(
  req: Request,
  res: Response,
  next: () => void,
): void {
  const signature = req.headers["x-twilio-signature"] as string;
  const url = `${env.BETTER_AUTH_URL}/webhooks/twilio/inbound`;

  const isValid = twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    req.body as Record<string, string>,
  );

  if (!isValid && env.NODE_ENV === "production") {
    logger.warn("Invalid Twilio signature");
    res.status(403).send("Forbidden");
    return;
  }

  next();
}

// ─── Inbound message from WhatsApp / SMS ─────
router.post(
  "/twilio/inbound",
  validateTwilioSignature,
  asyncHandler(async (req, res) => {
    const comm = await processInboundMessage(req.body);

    if (comm) {
      // Re-score the lead on new inbound activity
      await aiScoreQueue.add(
        "score-lead",
        { tenantId: comm.tenantId, leadId: comm.leadId },
        { delay: 2000 }, // slight delay so DB write settles
      );
    }

    // Twilio expects TwiML response (empty = no auto-reply)
    res.setHeader("Content-Type", "text/xml");
    return res.send("<Response></Response>");
  }),
);

// ─── Delivery status callback ─────────────────
router.post(
  "/twilio/status",
  validateTwilioSignature,
  asyncHandler(async (req, res) => {
    const { MessageSid, MessageStatus } = req.body as Record<string, string>;
    await updateDeliveryStatus(MessageSid, MessageStatus);
    return res.sendStatus(204);
  }),
);

export default router;
