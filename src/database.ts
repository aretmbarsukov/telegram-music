import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';

let client: PrismaClient | undefined;
export function getDatabase(): PrismaClient {
  if (!client) {
    if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for database-backed API routes');
    const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
    client = new PrismaClient({ adapter });
  }
  return client;
}
export async function closeDatabase(): Promise<void> { if (client) await client.$disconnect(); client = undefined; }
