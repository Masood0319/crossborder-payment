import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createKycDocumentEncryptionService } from '../src/gateway/kyc-encryption.js';

const prisma = new PrismaClient();
const encryption = createKycDocumentEncryptionService();

async function main() {
  let rotated = 0;
  const batchSize = 50;
  while (true) {
    const documents = await prisma.kycDocument.findMany({
      where: {
        ciphertext: { not: null },
        keyVersion: { not: encryption.keyProvider.getActiveVersion() },
      },
      select: {
        id: true,
        keyVersion: true,
        wrappedDataKey: true,
        keyWrapNonce: true,
        keyWrapTag: true,
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    if (documents.length === 0) break;

    for (const document of documents) {
      const wrapped = encryption.rotateWrappedDataKey(document);
      const result = await prisma.kycDocument.updateMany({
        where: { id: document.id, keyVersion: document.keyVersion },
        data: wrapped,
      });
      rotated += result.count;
    }
  }
  console.log(`Rewrapped ${rotated} KYC document data keys. Ciphertexts were not changed.`);
}

main()
  .catch(error => {
    console.error('KYC key rotation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
