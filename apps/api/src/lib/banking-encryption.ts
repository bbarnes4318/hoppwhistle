/**
 * Banking Data Encryption Utility
 * Uses AES-256-GCM for application-layer encryption of sensitive banking data
 */
import crypto from 'crypto';

// Get encryption key from environment - MUST be 32 bytes (64 hex chars)
const ENCRYPTION_KEY = process.env.BANKING_ENCRYPTION_KEY;

interface BankingData {
  bankName: string;
  accountNumber: string;
  routingNumber: string;
}

interface EncryptedResult {
  encryptedData: string;
  iv: string;
  authTag: string;
  maskedAccountNumber: string;
}

/**
 * Encrypts banking data using AES-256-GCM
 */
export function encryptBankingData(data: BankingData): EncryptedResult {
  if (!ENCRYPTION_KEY) {
    throw new Error('BANKING_ENCRYPTION_KEY environment variable is not set');
  }

  // Convert hex key to buffer
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('BANKING_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.randomBytes(12);

  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Encrypt the JSON data
  const jsonData = JSON.stringify(data);
  let encrypted = cipher.update(jsonData, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Create masked account number (last 4 digits)
  const maskedAccountNumber = '****' + data.accountNumber.slice(-4);

  return {
    encryptedData: encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    maskedAccountNumber,
  };
}

/**
 * Decrypts banking data using AES-256-GCM
 */
export function decryptBankingData(
  encryptedData: string,
  iv: string,
  authTag: string
): BankingData {
  if (!ENCRYPTION_KEY) {
    throw new Error('BANKING_ENCRYPTION_KEY environment variable is not set');
  }

  // Convert hex key to buffer
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('BANKING_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  // Create decipher
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));

  // Set auth tag
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  // Decrypt
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted) as BankingData;
}
