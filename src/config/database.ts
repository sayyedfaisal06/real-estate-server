// src/config/database.ts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };

export async function connectDB() {
  await prisma.$connect();
  console.log("✅ Database connected");
}

export async function disconnectDB() {
  await prisma.$disconnect();
}
