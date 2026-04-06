// src/services/ai.service.ts
import Groq from "groq-sdk";
import { env } from "../config";
import { prisma } from "../config/database";
import { logger } from "../utils/logger";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

// ─── Score a lead ─────────────────────────────
export async function scoreLead(tenantId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      comms: { orderBy: { sentAt: "desc" }, take: 10 },
      siteVisits: { orderBy: { scheduledAt: "desc" }, take: 3 },
      stageLogs: { orderBy: { movedAt: "desc" }, take: 5 },
    },
  });

  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const context = {
    name: lead.name,
    source: lead.source,
    stage: lead.stage,
    daysSinceCreated: Math.floor(
      (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    ),
    commCount: lead.comms.length,
    lastCommChannel: lead.comms[0]?.channel ?? null,
    lastCommDirection: lead.comms[0]?.direction ?? null,
    visitCount: lead.siteVisits.length,
    lastVisitOutcome: lead.siteVisits[0]?.outcome ?? null,
    stageHistory: lead.stageLogs.map((l) => l.toStage),
    budget: lead.budget?.toString() ?? null,
  };

  const prompt = `
You are a real estate lead scoring model. Based on the lead context below, return ONLY a JSON object.

Lead context:
${JSON.stringify(context, null, 2)}

Return this exact JSON structure:
{
  "intentLevel": "HOT" | "WARM" | "COLD",
  "probability": <number 0.0 to 1.0>,
  "suggestedAction": "<one concrete next action>",
  "reasoning": "<one sentence explanation>"
}
`;

  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");

    const result = JSON.parse(content) as {
      intentLevel: "HOT" | "WARM" | "COLD";
      probability: number;
      suggestedAction: string;
      reasoning: string;
    };

    const score = await prisma.aIScore.create({
      data: {
        tenantId,
        leadId,
        intentLevel: result.intentLevel,
        probability: result.probability,
        suggestedAction: result.suggestedAction,
        reasoning: result.reasoning,
      },
    });

    // Update lead score (0–100)
    await prisma.lead.update({
      where: { id: leadId },
      data: { score: Math.round(result.probability * 100) },
    });

    logger.info("Lead scored", {
      leadId,
      intentLevel: result.intentLevel,
      probability: result.probability,
    });
    return score;
  } catch (err) {
    logger.error("AI scoring failed", { err, leadId });
    throw err;
  }
}

// ─── Generate follow-up message ───────────────
export async function generateFollowUp(
  leadId: string,
  tenantId: string,
  channel: "WHATSAPP" | "SMS" | "EMAIL",
): Promise<string> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      project: { select: { name: true, location: true } },
      comms: { orderBy: { sentAt: "desc" }, take: 5 },
      siteVisits: { orderBy: { scheduledAt: "desc" }, take: 1 },
    },
  });

  if (!lead) throw new Error("Lead not found");

  const channelInstructions = {
    WHATSAPP:
      "Write a conversational WhatsApp message. Keep it under 150 words. Use a friendly tone.",
    SMS: "Write a concise SMS message. Keep it under 60 words. Be clear and direct.",
    EMAIL:
      "Write a professional email with a subject line. Keep it under 200 words.",
  };

  const prompt = `
You are a real estate sales assistant helping a builder follow up with a prospect.

Lead details:
- Name: ${lead.name}
- Project of interest: ${lead.project?.name ?? "Not specified"} in ${lead.project?.location ?? "unknown location"}
- Current stage: ${lead.stage}
- Last communication: ${lead.comms[0]?.content?.slice(0, 100) ?? "None yet"}
- Site visit: ${lead.siteVisits[0] ? `Scheduled on ${lead.siteVisits[0].scheduledAt.toDateString()}` : "Not yet scheduled"}

Channel: ${channel}
${channelInstructions[channel]}

Return ONLY the message text, no explanation.
`;

  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  });

  return res.choices[0]?.message?.content?.trim() ?? "";
}
