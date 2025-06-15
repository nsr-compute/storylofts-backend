// src/services/secrets.ts - Google Secret Manager Integration
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

class SecretsService {
  private client: SecretManagerServiceClient;
  private projectId: string;
  private secretsCache: Map<string, string> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'storylofts-secrets';
    
    // Initialize Secret Manager client
    this.client = new SecretManagerServiceClient({
      // In production, use service account key or workload identity
      // In development, use GOOGLE_APPLICATION_CREDENTIALS env var
      ...(process.env.GOOGLE_APPLICATION_CREDENTIALS && {
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
      })
    });
  }

  /**
   * Get secret value from Google Secret Manager with caching
   */
  async getSecret(secretName: string, version: string = 'latest'): Promise<string> {
    const cacheKey = `${secretName}:${version}`;
    const now = Date.now();

    // Check cache first
    if (this.secretsCache.has(cacheKey)) {
      const expiry = this.cacheExpiry.get(cacheKey) || 0;
      if (now < expiry) {
        return this.secretsCache.get(cacheKey)!;
      }
    }

    try {
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/${version}`;
      const [accessResponse] = await this.client.accessSecretVersion({ name });
      
      const secret = accessResponse.payload?.data?.toString();
      if (!secret) {
        throw new Error(`Secret ${secretName} is empty`);
      }

      // Cache the secret
      this.secretsCache.set(cacheKey, secret);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL);

      return secret;
    } catch (error) {
      console.error(`Failed to get secret ${secretName}:`, error);
      throw new Error(`Failed to retrieve secret: ${secretName}`);
    }
  }

  /**
   * Get multiple secrets at once
   */
  async getSecrets(secretNames: string[]): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {};
    
    await Promise.all(
      secretNames.map(async (name) => {
        try {
          secrets[name] = await this.getSecret(name);
        } catch (error) {
          console.error(`Failed to get secret ${name}:`, error);
          // Don't throw, let individual secrets fail
        }
      })
    );

    return secrets;
  }

  /**
   * Create or update a secret (for deployment scripts)
   */
  async createSecret(secretName: string, secretValue: string): Promise<void> {
    try {
      const parent = `projects/${this.projectId}`;
      
      // First, try to create the secret
      try {
        await this.client.createSecret({
          parent,
          secretId: secretName,
          secret: {
            replication: {
              automatic: {}
            }
          }
        });
      } catch (error: any) {
        // Secret might already exist, that's fine
        if (!error.message.includes('already exists')) {
          throw error;
        }
      }

      // Add the secret version
      const name = `projects/${this.projectId}/secrets/${secretName}`;
      await this.client.addSecretVersion({
        parent: name,
        payload: {
          data: Buffer.from(secretValue, 'utf8')
        }
      });

      console.log(`Secret ${secretName} created/updated successfully`);
    } catch (error) {
      console.error(`Failed to create secret ${secretName}:`, error);
      throw error;
    }
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.secretsCache.clear();
    this.cacheExpiry.clear();
  }
}

export const secretsService = new SecretsService();

// Helper function to get all required secrets for the application
export async function loadApplicationSecrets(): Promise<{
  auth0Domain: string;
  auth0Audience: string;
  b2ApplicationKeyId: string;
  b2ApplicationKey: string;
  b2BucketId: string;
  b2BucketName: string;
}> {
  const requiredSecrets = [
    'auth0-domain',
    'auth0-audience', 
    'b2-application-key-id',
    'b2-application-key',
    'b2-bucket-id',
    'b2-bucket-name'
  ];

  const secrets = await secretsService.getSecrets(requiredSecrets);

  return {
    auth0Domain: secrets['auth0-domain'],
    auth0Audience: secrets['auth0-audience'],
    b2ApplicationKeyId: secrets['b2-application-key-id'],
    b2ApplicationKey: secrets['b2-application-key'],
    b2BucketId: secrets['b2-bucket-id'],
    b2BucketName: secrets['b2-bucket-name']
  };
}