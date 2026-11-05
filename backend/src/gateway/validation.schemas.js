// ============================================================================
// Zod Request Validation Schemas
// ============================================================================

import { z } from 'zod';

export const InitiatePaymentSchema = z.object({
  corridorCode: z.enum(['PK_AE', 'AE_PK', 'PK_SA', 'SA_PK']),
  instructedAmount: z.number().positive('Instructed amount must be greater than zero'),
  instructedCurrency: z.enum(['PKR', 'AED', 'SAR']),
  targetCurrency: z.enum(['PKR', 'AED', 'SAR']),
  senderBic: z.string().min(8).max(11),
  senderIban: z.string().min(15).max(34),
  senderName: z.string().min(2).max(140),
  receiverBic: z.string().min(8).max(11),
  receiverIban: z.string().min(15).max(34),
  receiverName: z.string().min(2).max(140),
  remittanceInformation: z.string().max(140).optional(),
  quoteId: z.string().uuid().optional(),
});

export const BankCallbackSchema = z.object({
  messageId: z.string().min(10).max(64),
  originalEndToEndId: z.string().min(10),
  originalUetr: z.string().uuid(),
  transactionStatus: z.enum(['ACCP', 'RJCT', 'PDNG']),
  statusReasonCode: z.string().optional(),
  statusReasonNarrative: z.string().optional(),
  clearingSystemRef: z.string().optional(),
  instructingBic: z.string().min(8).max(11),
  instructedBic: z.string().min(8).max(11),
  timestamp: z.string().datetime().optional(),
});
