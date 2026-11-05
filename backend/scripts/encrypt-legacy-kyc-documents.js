import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createKycDocumentEncryptionService } from '../src/gateway/kyc-encryption.js';

if (process.env.CONFIRM_KYC_LEGACY_ENCRYPTION !== 'YES') {
  throw new Error('Set CONFIRM_KYC_LEGACY_ENCRYPTION=YES after taking and verifying a protected backup');
}

const prisma = new PrismaClient();
const encryption = createKycDocumentEncryptionService();

async function main() {
  let migrated = 0;
  const batchSize = 50;
  while (true) {
    const documents = await prisma.kycDocument.findMany({
      where: { fileData: { not: null } },
      select: { id: true, fileData: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    if (documents.length === 0) break;

    for (const document of documents) {
      await prisma.$transaction(async tx => {
        const current = await tx.kycDocument.findUnique({
          where: { id: document.id },
          select: { fileData: true },
        });
        if (!current?.fileData) return;
        const encrypted = encryption.encrypt(document.id, current.fileData);
        const result = await tx.kycDocument.updateMany({
          where: { id: document.id, fileData: { not: null }, ciphertext: null },
          data: { ...encrypted, fileData: null },
        });
        if (result.count > 1) throw new Error('Unexpected KYC document migration row count');
        migrated += result.count;
      });
    }
  }
  console.log(`Encrypted ${migrated} legacy KYC documents. No document contents were logged.`);
}

main()
  .catch(error => {
    console.error('Legacy KYC document encryption failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
