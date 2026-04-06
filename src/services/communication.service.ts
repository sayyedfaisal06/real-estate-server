// src/services/communication.service.ts
import twilio from "twilio";
import { env } from "../config";
import { prisma } from "../config/database";
import { logger } from "../utils/logger";
import { CommChannel } from "../generated/prisma/client";

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

interface SendMessageOptions {
  tenantId: string;
  leadId: string;
  to: string;
  content: string;
  channel: "WHATSAPP" | "SMS";
  mediaUrl?: string;
}

// ─── Send outbound message ────────────────────
export async function sendMessage(opts: SendMessageOptions) {
  const { tenantId, leadId, to, content, channel, mediaUrl } = opts;

  const from =
    channel === "WHATSAPP"
      ? env.TWILIO_WHATSAPP_NUMBER!
      : env.TWILIO_PHONE_NUMBER!;

  const toFormatted = channel === "WHATSAPP" ? `whatsapp:${to}` : to;

  try {
    const msg = await client.messages.create({
      from,
      to: toFormatted,
      body: content,
      ...(mediaUrl && { mediaUrl: [mediaUrl] }),
    });

    // Log in DB
    await prisma.communication.create({
      data: {
        tenantId,
        leadId,
        channel: channel as CommChannel,
        direction: "OUTBOUND",
        content,
        status: "SENT",
        externalId: msg.sid,
        metadata: { twilioStatus: msg.status },
      },
    });

    // Update lead last contacted timestamp
    await prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    logger.info("Message sent", { leadId, channel, sid: msg.sid });
    return msg;
  } catch (err) {
    logger.error("Failed to send message", { err, leadId, channel });

    await prisma.communication.create({
      data: {
        tenantId,
        leadId,
        channel: channel as CommChannel,
        direction: "OUTBOUND",
        content,
        status: "FAILED",
        metadata: { error: String(err) },
      },
    });

    throw err;
  }
}

// ─── Process inbound webhook from Twilio ──────
export async function processInboundMessage(payload: {
  From: string;
  To: string;
  Body: string;
  SmsStatus?: string;
  WaId?: string;
  MessageSid: string;
}) {
  const phone = payload.From.replace("whatsapp:", "").replace("+", "");
  const channel: CommChannel = payload.From.startsWith("whatsapp:")
    ? "WHATSAPP"
    : "SMS";

  // Find lead by phone (strip country code variants)
  const lead = await prisma.lead.findFirst({
    where: {
      phone: { endsWith: phone.slice(-10) },
      isDeleted: false,
    },
    select: { id: true, tenantId: true },
  });

  if (!lead) {
    logger.warn("Inbound message from unknown lead", { phone });
    return null;
  }

  const comm = await prisma.communication.create({
    data: {
      tenantId: lead.tenantId,
      leadId: lead.id,
      channel,
      direction: "INBOUND",
      content: payload.Body,
      status: "DELIVERED",
      externalId: payload.MessageSid,
    },
  });

  // Update last contacted
  await prisma.lead.update({
    where: { id: lead.id },
    data: { lastContactedAt: new Date() },
  });

  logger.info("Inbound message recorded", { leadId: lead.id, channel });
  return comm;
}

// ─── Update delivery status from status callback ─
export async function updateDeliveryStatus(messageSid: string, status: string) {
  const statusMap: Record<string, string> = {
    delivered: "DELIVERED",
    read: "READ",
    failed: "FAILED",
    undelivered: "FAILED",
  };

  await prisma.communication.updateMany({
    where: { externalId: messageSid },
    data: { status: (statusMap[status] ?? "SENT") as any },
  });
}
