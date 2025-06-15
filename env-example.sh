# .env.example - StoryLofts ContentHive API Environment Variables Template
# Copy this file to .env and fill in your actual values

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================
NODE_ENV=development
PORT=3000

# API URLs
API_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3001

# =============================================================================
# GOOGLE SECRET MANAGER CONFIGURATION
# =============================================================================
# Set to 'true' to use Google Secret Manager for sensitive values
USE_GOOGLE_SECRET_MANAGER=false
GOOGLE_CLOUD_PROJECT_ID=storylofts-secrets

# Path to Google Cloud service account JSON file (for local development)
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Or JSON content directly (for production/CI)
# GOOGLE_APPLICATION_CREDENTIALS_JSON={"type": "service_account", ...}

# =============================================================================
# AUTH0 CONFIGURATION
# =============================================================================
# These can be loaded from Google Secret Manager or set directly
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=https://your-api-identifier

# =============================================================================
# BACKBLAZE B2 CONFIGURATION
# =============================================================================
# These can be loaded from Google Secret Manager or set directly
B2_APPLICATION_KEY_ID=your_key_id
B2_APPLICATION_KEY=your_application_key
B2_BUCKET_ID=your_bucket_id
B2_BUCKET_NAME=your_bucket_name

# =============================================================================
# UPLOAD CONFIGURATION
# =============================================================================
# Maximum file size in bytes (default: 5GB)
MAX_FILE_SIZE=5368709120

# Allowed file formats (comma-separated)
ALLOWED_VIDEO_FORMATS=mp4,mov,avi,mkv,webm
ALLOWED_IMAGE_FORMATS=jpg,jpeg,png,webp

# =============================================================================
# DEVELOPMENT SETTINGS
# =============================================================================
# Additional CORS origins for development
DEV_CORS_ORIGINS=http://localhost:3001,http://127.0.0.1:3001

# Enable debug logging
DEBUG=storylofts:*

# =============================================================================
# PRODUCTION SETTINGS (for reference)
# =============================================================================
# NODE_ENV=production
# API_BASE_URL=https://api.storylofts.com
# FRONTEND_URL=https://storylofts.com
# USE_GOOGLE_SECRET_MANAGER=true

# =============================================================================
# SETUP INSTRUCTIONS
# =============================================================================
# 1. Copy this file to .env
# 2. Fill in your Auth0 and Backblaze B2 credentials
# 3. Set up Google Secret Manager (optional but recommended for production)
# 4. Run: npm run dev
# 
# For Google Secret Manager setup:
# 1. Create Google Cloud project: storylofts-secrets
# 2. Enable Secret Manager API
# 3. Create service account with Secret Manager access
# 4. Download service account key JSON
# 5. Run: npm run secrets:setup
#
# For production deployment:
# 1. Set USE_GOOGLE_SECRET_MANAGER=true
# 2. Store secrets in Google Secret Manager
# 3. Configure DigitalOcean with service account credentials
# 4. Deploy using GitHub Actions or DigitalOcean CLI