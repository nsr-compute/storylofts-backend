// scripts/setup-secrets.js - Setup secrets in Google Secret Manager
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const readline = require('readline');

const client = new SecretManagerServiceClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'storylofts-secrets';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptForSecret(secretName, description) {
  return new Promise((resolve) => {
    rl.question(`Enter ${description} (${secretName}): `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function createOrUpdateSecret(secretName, secretValue) {
  try {
    const parent = `projects/${projectId}`;
    
    // Try to create the secret first
    try {
      await client.createSecret({
        parent,
        secretId: secretName,
        secret: {
          replication: {
            automatic: {}
          }
        }
      });
      console.log(`✅ Created secret: ${secretName}`);
    } catch (error) {
      if (error.code === 6) { // ALREADY_EXISTS
        console.log(`ℹ️  Secret already exists: ${secretName}`);
      } else {
        throw error;
      }
    }

    // Add the secret version
    const name = `projects/${projectId}/secrets/${secretName}`;
    await client.addSecretVersion({
      parent: name,
      payload: {
        data: Buffer.from(secretValue, 'utf8')
      }
    });
    
    console.log(`✅ Updated secret value: ${secretName}`);
  } catch (error) {
    console.error(`❌ Failed to create/update secret ${secretName}:`, error.message);
  }
}

async function setupSecrets() {
  console.log('🔐 StoryLofts Secret Manager Setup');
  console.log('==================================');
  console.log(`Project ID: ${projectId}`);
  console.log('');

  const secrets = [
    {
      name: 'auth0-domain',
      description: 'Auth0 Domain (e.g., storylofts.auth0.com)',
      example: 'storylofts.auth0.com'
    },
    {
      name: 'auth0-audience',
      description: 'Auth0 API Audience (e.g., https://api.storylofts.com)',
      example: 'https://api.storylofts.com'
    },
    {
      name: 'b2-application-key-id',
      description: 'Backblaze B2 Application Key ID',
      example: '005a1b2c3d4e5f6789012345'
    },
    {
      name: 'b2-application-key',
      description: 'Backblaze B2 Application Key',
      example: 'K005abcdefghijklmnopqrstuvwxyz1234567890'
    },
    {
      name: 'b2-bucket-id',
      description: 'Backblaze B2 Bucket ID',
      example: 'a1b2c3d4e5f6789012345678'
    },
    {
      name: 'b2-bucket-name',
      description: 'Backblaze B2 Bucket Name',
      example: 'storylofts-videos'
    }
  ];

  console.log('Please provide the following secret values:');
  console.log('');

  for (const secret of secrets) {
    console.log(`${secret.description}`);
    console.log(`Example: ${secret.example}`);
    const value = await promptForSecret(secret.name, secret.description);
    
    if (value) {
      await createOrUpdateSecret(secret.name, value);
      console.log('');
    } else {
      console.log(`⚠️  Skipped: ${secret.name}`);
      console.log('');
    }
  }

  console.log('🎉 Secret setup complete!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Verify secrets in Google Cloud Console');
  console.log('2. Update DigitalOcean environment variables');
  console.log('3. Deploy your application');
  
  rl.close();
}

// Verify Google Cloud authentication
async function verifyAuth() {
  try {
    const [projects] = await client.getProjectId ? await client.getProjectId() : [projectId];
    console.log(`✅ Google Cloud authentication verified for project: ${projects || projectId}`);
    return true;
  } catch (error) {
    console.error('❌ Google Cloud authentication failed:');
    console.error('Please ensure you have:');
    console.error('1. Installed Google Cloud SDK: https://cloud.google.com/sdk/docs/install');
    console.error('2. Authenticated: gcloud auth application-default login');
    console.error('3. Set project: gcloud config set project storylofts-secrets');
    console.error('');
    console.error('Or set GOOGLE_APPLICATION_CREDENTIALS environment variable');
    console.error('Error details:', error.message);
    return false;
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting StoryLofts Secret Setup...');
  console.log('');
  
  const authValid = await verifyAuth();
  if (!authValid) {
    process.exit(1);
  }
  
  console.log('');
  await setupSecrets();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { createOrUpdateSecret, setupSecrets };