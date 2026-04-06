// prisma/seed.ts
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Tenant ──────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: "demo" },
    update: {},
    create: {
      name: "Prestige Builders (Demo)",
      subdomain: "demo",
      plan: "GROWTH",
    },
  });

  console.log(`✅ Tenant: ${tenant.name}`);

  // ─── Users ───────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@demo.com" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Admin User",
      email: "admin@demo.com",
      role: "BUILDER_ADMIN",
    },
  });

  const agent1 = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: tenant.id, email: "agent1@demo.com" },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Rahul Sharma",
      email: "agent1@demo.com",
      role: "AGENT",
    },
  });

  const agent2 = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: tenant.id, email: "agent2@demo.com" },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Priya Nair",
      email: "agent2@demo.com",
      role: "AGENT",
    },
  });

  console.log(`✅ Users: ${admin.name}, ${agent1.name}, ${agent2.name}`);

  // ─── Project ─────────────────────────────────
  const project = await prisma.project.upsert({
    where: { id: "seed-project-001" },
    update: {},
    create: {
      id: "seed-project-001",
      tenantId: tenant.id,
      name: "Prestige Heights",
      location: "Whitefield, Bengaluru",
      description: "Luxury 2 & 3 BHK apartments with world-class amenities",
      amenities: [
        "Swimming Pool",
        "Gym",
        "Clubhouse",
        "EV Charging",
        "24/7 Security",
      ],
    },
  });

  console.log(`✅ Project: ${project.name}`);

  // ─── Units ───────────────────────────────────
  const unitTypes = [
    { type: "2BHK", price: 8500000, areaSqft: 1150 },
    { type: "3BHK", price: 12000000, areaSqft: 1600 },
    { type: "3BHK Premium", price: 15000000, areaSqft: 1900 },
  ];

  for (let floor = 1; floor <= 5; floor++) {
    for (let unit = 1; unit <= 4; unit++) {
      const typeInfo = unitTypes[(unit - 1) % unitTypes.length];
      await prisma.unit.upsert({
        where: {
          projectId_unitNumber: {
            projectId: project.id,
            unitNumber: `${floor}0${unit}`,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          projectId: project.id,
          unitNumber: `${floor}0${unit}`,
          tower: "A",
          floor,
          type: typeInfo.type,
          areaSqft: typeInfo.areaSqft,
          price: typeInfo.price,
          status: Math.random() > 0.3 ? "AVAILABLE" : "BOOKED",
        },
      });
    }
  }

  console.log("✅ 20 units created across 5 floors");

  // ─── Sample leads ─────────────────────────────
  const sampleLeads = [
    {
      name: "Arjun Mehta",
      phone: "9876543210",
      source: "WEBSITE_FORM" as const,
      stage: "HOT",
      score: 85,
    },
    {
      name: "Sunita Rao",
      phone: "9876543211",
      source: "WHATSAPP" as const,
      stage: "WARM",
      score: 60,
    },
    {
      name: "Vijay Krishnan",
      phone: "9876543212",
      source: "PROPERTY_PORTAL" as const,
      stage: "COLD",
      score: 30,
    },
    {
      name: "Deepa Iyer",
      phone: "9876543213",
      source: "REFERRAL" as const,
      stage: "HOT",
      score: 90,
    },
    {
      name: "Sanjay Gupta",
      phone: "9876543214",
      source: "PHONE_CALL" as const,
      stage: "WARM",
      score: 55,
    },
  ];

  const stages = [
    "NEW",
    "CONTACTED",
    "QUALIFIED",
    "VISIT_SCHEDULED",
    "VISIT_DONE",
  ] as const;

  for (let i = 0; i < sampleLeads.length; i++) {
    const l = sampleLeads[i];
    await prisma.lead.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: l.phone } },
      update: {},
      create: {
        tenantId: tenant.id,
        projectId: project.id,
        assignedToId: i % 2 === 0 ? agent1.id : agent2.id,
        name: l.name,
        phone: l.phone,
        source: l.source,
        stage: stages[i],
        score: l.score,
      },
    });
  }

  console.log(`✅ ${sampleLeads.length} sample leads created`);
  console.log("\n✨ Seed complete!");
  console.log("   Tenant subdomain: demo");
  console.log("   Admin email:      admin@demo.com");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
