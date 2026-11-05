// ============================================================================
// ISO 20022 XML Parser (JavaScript ES Modules)
// Robust regex-based XML extraction without heavy dependencies
// ============================================================================

import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

export function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

export function extractAttribute(xml, tagName, attrName) {
  const regex = new RegExp(`<${tagName}[^>]*?\\s+${attrName}="([^"]*)"[^>]*>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

export function unescapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseDecimal(value, fieldName) {
  if (value === null || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid or missing decimal value for ${fieldName}`);
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error(`Invalid decimal value for ${fieldName}`);
  return parsed;
}

/**
 * Parses pacs.008.001.10 XML
 * @param {string} xml
 * @returns {object}
 */
export function parsePacs008(xml) {
  if (!xml || !xml.includes('FIToFICstmrCdtTrf')) {
    throw new Error('Invalid pacs.008 document: FIToFICstmrCdtTrf root element missing');
  }

  const messageId = unescapeXml(extractTag(xml, 'MsgId'));
  const creationDateTime = extractTag(xml, 'CreDtTm');
  const endToEndId = unescapeXml(extractTag(xml, 'EndToEndId'));
  const uetr = extractTag(xml, 'UETR');

  const settlementAmountStr = extractTag(xml, 'IntrBkSttlmAmt');
  const settlementCurrency = extractAttribute(xml, 'IntrBkSttlmAmt', 'Ccy');
  const settlementAmount = parseDecimal(settlementAmountStr, 'IntrBkSttlmAmt');

  const instructedAmountStr = extractTag(xml, 'InstdAmt');
  const instructedCurrency = extractAttribute(xml, 'InstdAmt', 'Ccy');
  const instructedAmount = parseDecimal(instructedAmountStr, 'InstdAmt');

  const exchangeRateStr = extractTag(xml, 'XchgRate');
  const exchangeRate = exchangeRateStr ? parseDecimal(exchangeRateStr, 'XchgRate') : new Decimal(1);

  const debtorBlock = extractTag(xml, 'Dbtr');
  const debtorName = debtorBlock ? unescapeXml(extractTag(debtorBlock, 'Nm')) : '';

  const debtorAcctBlock = extractTag(xml, 'DbtrAcct');
  const debtorIban = debtorAcctBlock ? extractTag(debtorAcctBlock, 'IBAN') : '';

  const debtorAgtBlock = extractTag(xml, 'DbtrAgt');
  const debtorBic = debtorAgtBlock ? extractTag(debtorAgtBlock, 'BICFI') : '';

  const creditorAgtBlock = extractTag(xml, 'CdtrAgt');
  const creditorBic = creditorAgtBlock ? extractTag(creditorAgtBlock, 'BICFI') : '';

  const creditorBlock = extractTag(xml, 'Cdtr');
  const creditorName = creditorBlock ? unescapeXml(extractTag(creditorBlock, 'Nm')) : '';

  const creditorAcctBlock = extractTag(xml, 'CdtrAcct');
  const creditorIban = creditorAcctBlock ? extractTag(creditorAcctBlock, 'IBAN') : '';

  const remittanceInfo = unescapeXml(extractTag(xml, 'Ustrd'));

  return {
    messageType: 'pacs.008.001.10',
    messageId,
    creationDateTime,
    endToEndId,
    uetr,
    settlementAmount,
    settlementCurrency,
    instructedAmount,
    instructedCurrency,
    exchangeRate,
    debtorName,
    debtorIban,
    debtorBic,
    creditorName,
    creditorIban,
    creditorBic,
    remittanceInfo,
  };
}

/**
 * Parses pacs.002.001.12 XML
 * @param {string} xml
 * @returns {object}
 */
export function parsePacs002(xml) {
  if (!xml || !xml.includes('FIToFIPmtStsRpt')) {
    throw new Error('Invalid pacs.002 document: FIToFIPmtStsRpt root element missing');
  }

  const messageId = unescapeXml(extractTag(xml, 'MsgId'));
  const originalEndToEndId = unescapeXml(extractTag(xml, 'OrgnlEndToEndId'));
  const originalUetr = extractTag(xml, 'OrgnlUETR');
  const transactionStatus = extractTag(xml, 'TxSts'); // ACCP, RJCT, PDNG

  const statusReasonBlock = extractTag(xml, 'StsRsnInf');
  let statusReasonCode = null;
  let statusReasonNarrative = null;

  if (statusReasonBlock) {
    statusReasonCode = extractTag(statusReasonBlock, 'Cd');
    statusReasonNarrative = unescapeXml(extractTag(statusReasonBlock, 'AddtlInf'));
  }

  return {
    messageType: 'pacs.002.001.12',
    messageId,
    originalEndToEndId,
    originalUetr,
    transactionStatus,
    statusReasonCode,
    statusReasonNarrative,
  };
}
