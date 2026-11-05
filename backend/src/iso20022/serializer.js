// ============================================================================
// ISO 20022 XML Serializer (JavaScript ES Modules)
// Generates pacs.008.001.10 (Customer Credit Transfer) & pacs.002.001.12 (Payment Status)
// ============================================================================

import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
const currencyPrecision = { PKR: 2, AED: 2, SAR: 2, USD: 2 };

function formatDecimal(value, places) {
  return new Decimal(value.toString()).toFixed(places, Decimal.ROUND_HALF_UP);
}

function formatCurrencyAmount(value, currency) {
  const precision = currencyPrecision[currency];
  if (precision === undefined) throw new Error(`Unsupported ISO 20022 currency ${currency}`);
  const amount = new Decimal(value.toString());
  if (!amount.isFinite() || !amount.equals(amount.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP))) {
    throw new Error(`${currency} amount exceeds its supported minor-unit precision`);
  }
  return amount.toFixed(precision, Decimal.ROUND_HALF_UP);
}

export function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Serializes payment instruction into pacs.008.001.10 XML format
 * @param {object} p
 * @returns {string} XML string
 */
export function serializePacs008(p) {
  const creationDateTime = p.creationDateTime || new Date().toISOString();
  const chargeBearer = p.chargeBearer || 'SHAR';
  const clearingChannel = p.clearingChannel || 'MPNS';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.10">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${escapeXml(p.messageId)}</MsgId>
      <CreDtTm>${escapeXml(creationDateTime)}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
        <ClrSys>
          <Prtry>${escapeXml(p.settlementRail)}</Prtry>
        </ClrSys>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${escapeXml(p.endToEndId)}</EndToEndId>
        <UETR>${escapeXml(p.uetr)}</UETR>
        <ClrSysRef>${escapeXml(p.clearingSystemRef || p.endToEndId)}</ClrSysRef>
      </PmtId>
      <PmtTpInf>
        <ClrChanl>${escapeXml(clearingChannel)}</ClrChanl>
        <SvcLvl>
          <Cd>SDVA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Prtry>${escapeXml(p.corridorCode)}</Prtry>
        </LclInstrm>
      </PmtTpInf>
      <IntrBkSttlmAmt Ccy="${escapeXml(p.settlementCurrency)}">${formatCurrencyAmount(p.settlementAmount, p.settlementCurrency)}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${escapeXml(p.settlementDate || creationDateTime.substring(0, 10))}</IntrBkSttlmDt>
      <InstdAmt Ccy="${escapeXml(p.instructedCurrency)}">${formatCurrencyAmount(p.instructedAmount, p.instructedCurrency)}</InstdAmt>
      <XchgRate>${formatDecimal(p.exchangeRate, 6)}</XchgRate>
      <ChrgBr>${escapeXml(chargeBearer)}</ChrgBr>
      <Dbtr>
        <Nm>${escapeXml(p.debtorName)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${escapeXml(p.debtorIban)}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>${escapeXml(p.debtorBic)}</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>${escapeXml(p.creditorBic)}</BICFI>
        </FinInstnId>
      </CdtrAgt>
      <Cdtr>
        <Nm>${escapeXml(p.creditorName)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>${escapeXml(p.creditorIban)}</IBAN>
        </Id>
      </CdtrAcct>
      <RmtInf>
        <Ustrd>${escapeXml(p.remittanceInformation || 'Cross-Border Fast Settlement')}</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

/**
 * Serializes payment confirmation or rejection into pacs.002.001.12 XML format
 * @param {object} p
 * @returns {string} XML string
 */
export function serializePacs002(p) {
  const creationDateTime = p.creationDateTime || new Date().toISOString();
  const reasonCodeBlock = p.statusReasonCode
    ? `<StsRsnInf>
        <Rsn>
          <Cd>${escapeXml(p.statusReasonCode)}</Cd>
        </Rsn>
        <AddtlInf>${escapeXml(p.statusReasonNarrative || '')}</AddtlInf>
      </StsRsnInf>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.12">
  <FIToFIPmtStsRpt>
    <GrpHdr>
      <MsgId>${escapeXml(p.messageId)}</MsgId>
      <CreDtTm>${escapeXml(creationDateTime)}</CreDtTm>
    </GrpHdr>
    <OrgnlGrpInfAndSts>
      <OrgnlMsgId>${escapeXml(p.originalMessageId)}</OrgnlMsgId>
      <OrgnlMsgNmId>pacs.008.001.10</OrgnlMsgNmId>
    </OrgnlGrpInfAndSts>
    <TxInfAndSts>
      <OrgnlEndToEndId>${escapeXml(p.originalEndToEndId)}</OrgnlEndToEndId>
      <OrgnlUETR>${escapeXml(p.originalUetr)}</OrgnlUETR>
      <TxSts>${escapeXml(p.transactionStatus)}</TxSts>
      ${reasonCodeBlock}
      <ClrSysRef>${escapeXml(p.clearingSystemRef || p.originalEndToEndId)}</ClrSysRef>
      <InstgAgt>
        <FinInstnId>
          <BICFI>${escapeXml(p.instructingBic)}</BICFI>
        </FinInstnId>
      </InstgAgt>
      <InstdAgt>
        <FinInstnId>
          <BICFI>${escapeXml(p.instructedBic)}</BICFI>
        </FinInstnId>
      </InstdAgt>
    </TxInfAndSts>
  </FIToFIPmtStsRpt>
</Document>`;
}
