/* eslint-disable @typescript-eslint/no-explicit-any */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const connStr = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: connStr });
const adapter = new PrismaPg(pool as any);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter, log: ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
