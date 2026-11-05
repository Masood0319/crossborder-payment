import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.partnerIdempotency.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'FAILED'] },
      expiresAt: { lte: new Date() },
    },
  });
  console.log(`Purged ${result.count} expired final partner idempotency records.`);
}

main()
  .catch(error => {
    console.error('Partner idempotency retention cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
