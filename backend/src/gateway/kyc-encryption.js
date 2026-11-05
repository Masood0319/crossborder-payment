import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AES_GCM = 'AES-256-GCM';
const AES_NONCE_BYTES = 12;
const AES_TAG_BYTES = 16;

function assertKey(key, version) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(`KYC key version ${version} must decode to exactly 32 bytes`);
  }
}

function isBytes(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function decodeKeySet(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('KYC_KEK_KEYS_JSON must be a JSON object of versioned base64 keys');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('KYC_KEK_KEYS_JSON must be a JSON object of versioned base64 keys');
  }
  const keys = new Map();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(version) || typeof encoded !== 'string') {
      throw new Error('KYC key versions and values have invalid formats');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.toString('base64') !== encoded) throw new Error(`KYC key version ${version} is not valid base64`);
    assertKey(key, version);
    keys.set(version, key);
  }
  if (keys.size === 0) throw new Error('At least one KYC key-encryption key is required');
  return keys;
}

function encryptAesGcm(key, plaintext, additionalData) {
  const nonce = randomBytes(AES_NONCE_BYTES);
  const cipher = createCipheriv(AES_GCM, key, nonce);
  cipher.setAAD(Buffer.from(additionalData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

function decryptAesGcm(key, ciphertext, nonce, tag, additionalData) {
  if (!isBytes(ciphertext)
    || !isBytes(nonce) || nonce.length !== AES_NONCE_BYTES
    || !isBytes(tag) || tag.length !== AES_TAG_BYTES) {
    throw new Error('Encrypted KYC document authentication metadata is invalid');
  }
  const decipher = createDecipheriv(AES_GCM, key, Buffer.from(nonce));
  decipher.setAAD(Buffer.from(additionalData, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
}

export class LocalEnvelopeKeyProvider {
  constructor({ keys, activeVersion }) {
    if (!(keys instanceof Map) || !keys.has(activeVersion)) {
      throw new Error('Active KYC envelope key version is not available');
    }
    for (const [version, key] of keys) assertKey(key, version);
    this.keys = new Map(keys);
    this.activeVersion = activeVersion;
  }

  static fromEnvironment(environment = process.env) {
    const serialized = environment.KYC_KEK_KEYS_JSON;
    const activeVersion = environment.KYC_KEK_ACTIVE_VERSION;
    if (!serialized || !activeVersion) {
      throw new Error('KYC envelope encryption is not configured');
    }
    return new LocalEnvelopeKeyProvider({
      keys: decodeKeySet(serialized),
      activeVersion,
    });
  }

  getActiveVersion() {
    return this.activeVersion;
  }

  wrapDataKey(dataKey, version = this.activeVersion) {
    const key = this.keys.get(version);
    if (!key) throw new Error(`KYC envelope key version ${version} is unavailable`);
    return { version, ...encryptAesGcm(key, dataKey, `kyc-data-key:${version}`) };
  }

  unwrapDataKey(wrappedKey) {
    const key = this.keys.get(wrappedKey.version);
    if (!key) throw new Error(`KYC envelope key version ${wrappedKey.version} is unavailable`);
    return decryptAesGcm(
      key,
      wrappedKey.ciphertext,
      wrappedKey.nonce,
      wrappedKey.tag,
      `kyc-data-key:${wrappedKey.version}`
    );
  }
}

export class KycDocumentEncryptionService {
  constructor(keyProvider) {
    if (!keyProvider
      || typeof keyProvider.wrapDataKey !== 'function'
      || typeof keyProvider.unwrapDataKey !== 'function'
      || typeof keyProvider.getActiveVersion !== 'function') {
      throw new Error('KYC envelope key provider does not implement the required interface');
    }
    this.keyProvider = keyProvider;
  }

  encrypt(documentId, plaintext) {
    const dataKey = randomBytes(32);
    try {
      const wrapped = this.keyProvider.wrapDataKey(dataKey);
      const encrypted = encryptAesGcm(dataKey, plaintext, `kyc-document:${documentId}:v1`);
      return {
        ciphertext: encrypted.ciphertext,
        encryptionNonce: encrypted.nonce,
        authenticationTag: encrypted.tag,
        keyVersion: wrapped.version,
        wrappedDataKey: wrapped.ciphertext,
        keyWrapNonce: wrapped.nonce,
        keyWrapTag: wrapped.tag,
        encryptionAlgorithm: AES_GCM,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  decrypt(document) {
    if (document.encryptionAlgorithm !== AES_GCM
      || !document.ciphertext
      || !document.keyVersion
      || !document.wrappedDataKey) {
      throw new Error('KYC document is legacy plaintext or has incomplete encryption metadata');
    }
    const dataKey = this.keyProvider.unwrapDataKey({
      version: document.keyVersion,
      ciphertext: document.wrappedDataKey,
      nonce: document.keyWrapNonce,
      tag: document.keyWrapTag,
    });
    try {
      return decryptAesGcm(
        dataKey,
        document.ciphertext,
        document.encryptionNonce,
        document.authenticationTag,
        `kyc-document:${document.id}:v1`
      );
    } finally {
      dataKey.fill(0);
    }
  }

  rotateWrappedDataKey(document) {
    if (!document.keyVersion || !document.wrappedDataKey) {
      throw new Error('Legacy KYC documents require explicit encryption before key rotation');
    }
    const dataKey = this.keyProvider.unwrapDataKey({
      version: document.keyVersion,
      ciphertext: document.wrappedDataKey,
      nonce: document.keyWrapNonce,
      tag: document.keyWrapTag,
    });
    try {
      const wrapped = this.keyProvider.wrapDataKey(dataKey);
      return {
        keyVersion: wrapped.version,
        wrappedDataKey: wrapped.ciphertext,
        keyWrapNonce: wrapped.nonce,
        keyWrapTag: wrapped.tag,
      };
    } finally {
      dataKey.fill(0);
    }
  }
}

export function createKycDocumentEncryptionService(environment = process.env) {
  return new KycDocumentEncryptionService(LocalEnvelopeKeyProvider.fromEnvironment(environment));
}
