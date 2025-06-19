// src/config/index.ts - Configuration for StoryLofts
import dotenv from 'dotenv';
import { loadApplicationSecrets } from '../services/secrets';

dotenv.config();

interface Config {
  server: {
    port: number;
    nodeEnv: string;
    apiBaseUrl: string;
    frontendUrl: string;
  };
  api: {
    baseUrl: string;
  };
  frontend: {
    url: string;
  };
  environment: string;
  auth0: {
    domain: string;
    audience: string;
  };
  backblaze: {
    applicationKeyId: string;
    applicationKey: string;
    bucketId: string;
    bucketName: string;
  };
  upload: {
    maxFileSize: number;
    allowedVideoFormats: string[];
    allowedImageFormats: string[];
  };
  secrets: {
    useGoogleSecretManager: boolean;
    googleCloudProjectId: string;
  };
}

// Base configuration (non-sensitive values)
const baseConfig: Omit<Config, 'auth0' | 'backblaze'> = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001'
  },
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000'
  },
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:3001'
  },
  environment: process.env.NODE_ENV || 'development',
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5368709120'), // 5GB
    allowedVideoFormats: (process.env.ALLOWED_VIDEO_FORMATS || 'mp4,mov,avi,mkv,webm').split(','),
    allowedImageFormats: (process.env.ALLOWED_IMAGE_FORMATS || 'jpg,jpeg,png,webp').split(',')
  },
  secrets: {
    useGoogleSecretManager: process.env.USE_GOOGLE_SECRET_MANAGER === 'true',
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID || 'storylofts-secrets'
  }
};

// Configuration loader function
async function loadConfig(): Promise<Config> {
  let auth0Config: Config['auth0'];
  let backblazeConfig: Config['backblaze'];

  if (baseConfig.secrets.useGoogleSecretManager) {
    console.log('Loading secrets from Google Secret Manager...');
    
    try {
      const secrets = await loadApplicationSecrets();
      
      auth0Config = {
        domain: secrets.auth0Domain,
        audience: secrets.auth0Audience
      };

      backblazeConfig = {
        applicationKeyId: secrets.b2ApplicationKeyId,
        applicationKey: secrets.b2ApplicationKey,
        bucketId: secrets.b2BucketId,
        bucketName: secrets.b2BucketName
      };

      console.log('✅ Secrets loaded from Google Secret Manager');
    } catch (error) {
      console.error('❌ Failed to load secrets from Google Secret Manager:', error);
      console.log('Falling back to environment variables...');
      
      // Fallback to environment variables
      auth0Config = {
        domain: process.env.AUTH0_DOMAIN!,
        audience: process.env.AUTH0_AUDIENCE!
      };

      backblazeConfig = {
        applicationKeyId: process.env.B2_APPLICATION_KEY_ID!,
        applicationKey: process.env.B2_APPLICATION_KEY!,
        bucketId: process.env.B2_BUCKET_ID!,
        bucketName: process.env.B2_BUCKET_NAME!
      };
    }
  } else {
    console.log('Loading secrets from environment variables...');
    
    auth0Config = {
      domain: process.env.AUTH0_DOMAIN!,
      audience: process.env.AUTH0_AUDIENCE!
    };

    backblazeConfig = {
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID!,
      applicationKey: process.env.B2_APPLICATION_KEY!,
      bucketId: process.env.B2_BUCKET_ID!,
      bucketName: process.env.B2_BUCKET_NAME!
    };
  }

  // Validate required configuration
  const requiredFields = [
    { key: 'auth0.domain', value: auth0Config.domain },
    { key: 'auth0.audience', value: auth0Config.audience },
    { key: 'backblaze.applicationKeyId', value: backblazeConfig.applicationKeyId },
    { key: 'backblaze.applicationKey', value: backblazeConfig.applicationKey },
    { key: 'backblaze.bucketId', value: backblazeConfig.bucketId },
    { key: 'backblaze.bucketName', value: backblazeConfig.bucketName }
  ];

  const missingFields = requiredFields.filter(field => !field.value);
  if (missingFields.length > 0) {
    const missing = missingFields.map(f => f.key).join(', ');
    throw new Error(`Missing required configuration: ${missing}`);
  }

  return {
    ...baseConfig,
    auth0: auth0Config,
    backblaze: backblazeConfig
  };
}

// ConfigService class for server.ts compatibility
class ConfigService {
  private cachedConfig: Config | null = null;

  private ensureString(value: string | undefined, defaultValue: string): string {
    return value && value.trim() !== '' ? value : defaultValue
  }

  getConfig(): Config {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    // Return synchronous config for immediate use with proper type safety
    const syncConfig: Config = {
      ...baseConfig,
      auth0: {
        domain: this.ensureString(process.env.AUTH0_DOMAIN, ''),
        audience: this.ensureString(process.env.AUTH0_AUDIENCE, '')
      },
      backblaze: {
        applicationKeyId: this.ensureString(process.env.B2_APPLICATION_KEY_ID, ''),
        applicationKey: this.ensureString(process.env.B2_APPLICATION_KEY, ''),
        bucketId: this.ensureString(process.env.B2_BUCKET_ID, ''),
        bucketName: this.ensureString(process.env.B2_BUCKET_NAME, '')
      }
    };

    this.cachedConfig = syncConfig;
    return syncConfig;
  }

  async getConfigAsync(): Promise<Config> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const config = await loadConfig();
    this.cachedConfig = config;
    return config;
  }
}

// Export singleton instance for server.ts
export const configService = new ConfigService();

// Export a promise that resolves to the configuration
export const configPromise = loadConfig();

// For backwards compatibility, export a synchronous config object
// This will only work if secrets are loaded from environment variables
const ensureString = (value: string | undefined, defaultValue: string): string => {
  return value && value.trim() !== '' ? value : defaultValue
}

export const config: Config = {
  ...baseConfig,
  auth0: {
    domain: ensureString(process.env.AUTH0_DOMAIN, ''),
    audience: ensureString(process.env.AUTH0_AUDIENCE, '')
  },
  backblaze: {
    applicationKeyId: ensureString(process.env.B2_APPLICATION_KEY_ID, ''),
    applicationKey: ensureString(process.env.B2_APPLICATION_KEY, ''),
    bucketId: ensureString(process.env.B2_BUCKET_ID, ''),
    bucketName: ensureString(process.env.B2_BUCKET_NAME, '')
  }
};

export type { Config };
