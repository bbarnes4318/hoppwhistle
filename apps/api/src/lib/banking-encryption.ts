/**
 * Banking Data Encryption Utility
 * Uses AES-256-GCM for secure encryption of sensitive banking information
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Environment variable for encryption key (32 bytes = 256 bits)
const ENCRYPTION_KEY_ENV = 'BANKING_ENCRYPTION_KEY';

interface BankingData {
  bankName: string;
  accountNumber: string;
  routingNumber: string;
}

interface EncryptedBankingData {
  encryptedData: string;
  iv: string;
  authTag: string;
  maskedAccountNumber: string;
}

interface DecryptedBankingData extends BankingData {}

/**
 * Get the encryption key from environment
 * Key must be exactly 32 bytes (64 hex characters) for AES-256
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env[ENCRYPTION_KEY_ENV];

  if (!keyHex) {
    throw new Error(`Missing required environment variable: ${ENCRYPTION_KEY_ENV}`);
  }

  if (keyHex.length !== 64) {
    throw new Error(`${ENCRYPTION_KEY_ENV} must be exactly 64 hex characters (32 bytes)`);
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Generate a masked account number for display (last 4 digits)
 */
export function maskAccountNumber(accountNumber: string): string {
  if (!accountNumber || accountNumber.length < 4) {
    return '****';
  }
  const last4 = accountNumber.slice(-4);
  return `****${last4}`;
}

/**
 * Encrypt banking data using AES-256-GCM
 */
export function encryptBankingData(data: BankingData): EncryptedBankingData {
  const key = getEncryptionKey();

  // Generate random 12-byte IV (recommended for GCM)
  const iv = randomBytes(12);

  // Create cipher
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  // Encrypt the JSON data
  const jsonData = JSON.stringify(data);
  let encrypted = cipher.update(jsonData, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    maskedAccountNumber: maskAccountNumber(data.accountNumber),
  };
}

/**
 * Decrypt banking data using AES-256-GCM
 */
export function decryptBankingData(
  encryptedData: string,
  iv: string,
  authTag: string
): DecryptedBankingData {
  const key = getEncryptionKey();

  // Create decipher
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));

  // Set auth tag for verification
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  // Decrypt
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted) as DecryptedBankingData;
}

/**
 * Check if encryption key is configured
 */
export function isEncryptionConfigured(): boolean {
  const keyHex = process.env[ENCRYPTION_KEY_ENV];
  return !!keyHex && keyHex.length === 64;
}

/**
 * Generate a new encryption key (for initial setup)
 * Run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}
