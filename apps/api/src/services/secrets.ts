import 'dotenv-flow/config';

/**
 * Secrets management with support for:
 * - Development: dotenv-flow
 * - Production: DigitalOcean Secrets Manager / KMS (placeholder)
 */
export class SecretsManager {
  private static instance: SecretsManager;
  private secrets: Map<string, string> = new Map();

  private constructor() {
    void this.loadSecrets();
  }

  static getInstance(): SecretsManager {
    if (!SecretsManager.instance) {
      SecretsManager.instance = new SecretsManager();
    }
    return SecretsManager.instance;
  }

  /**
   * Load secrets from environment or secrets manager
   */
  private async loadSecrets(): Promise<void> {
    const env = process.env.NODE_ENV || 'development';

    if (env === 'production') {
      // In production, load from DigitalOcean Secrets Manager or KMS
      await this.loadFromSecretsManager();
    } else {
      // In development, use dotenv-flow (already loaded via import)
      this.loadFromEnvironment();
    }
  }

  /**
   * Load secrets from DigitalOcean Secrets Manager or KMS
   * TODO: Implement actual integration with DO Secrets Manager or AWS KMS
   */
  private async loadFromSecretsManager(): Promise<void> {
    // Placeholder for production secrets loading
    // Example implementation:
    /*
    const doToken = process.env.DIGITALOCEAN_TOKEN;
    if (doToken) {
      // Fetch secrets from DO Secrets Manager
      const secrets = await fetchSecretsFromDO(doToken);
      secrets.forEach(secret => {
        this.secrets.set(secret.key, secret.value);
      });
    }
    */

    // For now, fall back to environment variables
    await Promise.resolve();
    this.loadFromEnvironment();
  }

  /**
   * Load secrets from environment variables
   */
  private loadFromEnvironment(): void {
    const secretKeys = [
      'JWT_SECRET',
      'DATABASE_URL',
      'REDIS_URL',
      'S3_SECRET_KEY',
      'S3_ACCESS_KEY',
      'STRIPE_SECRET_KEY',
      'JORNAYA_API_KEY',
      'TRUSTEDFORM_API_KEY',
      'TELNYX_API_KEY',
      'TELNYX_CONNECTION_ID',
      'BANDWIDTH_ACCOUNT_ID',
      'BANDWIDTH_USERNAME',
      'BANDWIDTH_PASSWORD',
      'BANDWIDTH_SITE_ID',
      'SIGNALWIRE_PROJECT_ID',
      'SIGNALWIRE_API_TOKEN',
      'SIGNALWIRE_SPACE_URL',
    ];

    secretKeys.forEach(key => {
      const value = process.env[key];
      if (value) {
        this.secrets.set(key, value);
      }
    });
  }

  /**
   * Get a secret value
   */
  get(key: string): string | undefined {
    return this.secrets.get(key) || process.env[key];
  }

  /**
   * Get a secret value or throw if not found
   */
  getRequired(key: string): string {
    const value = this.get(key);
    if (!value) {
      throw new Error(`Required secret ${key} is not set`);
    }
    return value;
  }

  /**
   * Check if a secret exists
   */
  has(key: string): boolean {
    return this.secrets.has(key) || !!process.env[key];
  }
}

export const secrets = SecretsManager.getInstance();
