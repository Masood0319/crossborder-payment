// ============================================================================
// ISO 20022 Validation Engine (JavaScript ES Modules)
// Validates ISO 13616 IBAN (MOD-97-10), ISO 9362 BIC, and RFC 4122 UUIDv4 UETR
// ============================================================================

export const IBAN_STRUCTURES = {
  PK: { length: 24, bbanPattern: /^[A-Z]{4}[0-9]{16}$/ }, // Pakistan (e.g. PK67MEZN0000001123456701)
  AE: { length: 23, bbanPattern: /^[0-9]{3}[0-9]{16}$/ },  // UAE (e.g. AE070331234567890123456)
  SA: { length: 24, bbanPattern: /^[0-9]{2}[A-Z0-9]{18}$/ },// Saudi Arabia (e.g. SA3180123456789012345678)
};

export const SUPPORTED_BICS = [
  'MEZNBPKK',     // Meezan Bank Ltd (Pakistan - Settlement Hub)
  'FABAEADU',     // First Abu Dhabi Bank (UAE - AANI Gateway)
  'RJHIBSRI',     // Al Rajhi Bank (Saudi Arabia - SARIE Gateway)
  'HBBKPKKA',     // Habib Bank Ltd (Pakistan)
  'EMRBAEAD',     // Emirates NBD (UAE)
  'NCBKSARI',     // National Commercial Bank / SNB (Saudi Arabia)
  'MEZNBPKKXXX',  // Meezan Bank 11-char BIC
  'FABAEADUXXX',  // FAB 11-char BIC
  'RJHIBSRIXXX',  // Al Rajhi 11-char BIC
];

/**
 * Validates an International Bank Account Number using ISO 7064 MOD-97-10 checksum
 * @param {string} iban
 * @returns {{ isValid: boolean, error?: string, countryCode?: string }}
 */
export function validateIban(iban) {
  if (!iban || typeof iban !== 'string') {
    return { isValid: false, error: 'IBAN must be a non-empty string' };
  }

  const cleanIban = iban.replace(/[\s-]/g, '').toUpperCase();
  if (cleanIban.length < 5) {
    return { isValid: false, error: 'IBAN length is too short' };
  }

  const countryCode = cleanIban.substring(0, 2);
  const spec = IBAN_STRUCTURES[countryCode];

  if (!spec) {
    return { isValid: false, error: `Country code '${countryCode}' is not supported by corridor policy` };
  }

  if (cleanIban.length !== spec.length) {
    return {
      isValid: false,
      error: `Invalid IBAN length for '${countryCode}'. Expected ${spec.length}, received ${cleanIban.length}`,
    };
  }

  const bban = cleanIban.substring(4);
  if (!spec.bbanPattern.test(bban)) {
    return { isValid: false, error: `BBAN structure is invalid for '${countryCode}'` };
  }

  // ISO 7064 MOD-97-10 Checksum Algorithm:
  // Move the first 4 characters to the end
  const rearranged = cleanIban.substring(4) + cleanIban.substring(0, 4);

  // Convert letters to digits (A=10, B=11, ... Z=35)
  let numericString = '';
  for (let i = 0; i < rearranged.length; i++) {
    const char = rearranged[i];
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      numericString += (code - 55).toString();
    } else if (code >= 48 && code <= 57) {
      numericString += char;
    } else {
      return { isValid: false, error: `Invalid character in IBAN: ${char}` };
    }
  }

  // Compute modulo 97 in chunks to avoid 64-bit integer overflow
  let remainder = 0;
  for (let i = 0; i < numericString.length; i += 7) {
    const chunk = remainder.toString() + numericString.substring(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }

  if (remainder !== 1) {
    return { isValid: false, error: `IBAN checksum validation failed (MOD-97 remainder was ${remainder}, expected 1)` };
  }

  return { isValid: true, countryCode };
}

/**
 * Validates a Bank Identifier Code (SWIFT / BIC) per ISO 9362
 * @param {string} bic
 * @returns {{ isValid: boolean, error?: string, isRecognized?: boolean }}
 */
export function validateBic(bic) {
  if (!bic || typeof bic !== 'string') {
    return { isValid: false, error: 'BIC must be a non-empty string' };
  }

  const cleanBic = bic.trim().toUpperCase();
  const bicRegex = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

  if (!bicRegex.test(cleanBic)) {
    return { isValid: false, error: 'BIC does not conform to ISO 9362 (8 or 11 characters required)' };
  }

  const isRecognized = SUPPORTED_BICS.includes(cleanBic);
  return { isValid: true, isRecognized };
}

/**
 * Validates a Universal End-to-End Transaction Reference (UETR) per RFC 4122 UUIDv4
 * @param {string} uetr
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateUetr(uetr) {
  if (!uetr || typeof uetr !== 'string') {
    return { isValid: false, error: 'UETR must be a non-empty string' };
  }

  const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidv4Regex.test(uetr.trim())) {
    return { isValid: false, error: 'UETR is not a valid RFC 4122 UUIDv4' };
  }

  return { isValid: true };
}
