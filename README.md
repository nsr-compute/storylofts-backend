# StoryLofts ContentHive Backend API

> Backend API for StoryLofts - a premium video content platform for professionals

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/nsr-compute/storylofts-backend)
[![API Status](https://img.shields.io/badge/api-live-brightgreen)](https://api.storylofts.com/health)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)

## 🎯 Overview

StoryLofts ContentHive is a professional-grade video content management API built for creators who value quality over quantity. Think "Vimeo for professionals, not YouTube for everyone" - focusing on curated storytelling and premium content experiences.

**Live API**: [https://api.storylofts.com](https://api.storylofts.com)

## ✨ Features

- 🔐 **Secure Authentication** - Auth0 JWT integration
- 📁 **File Upload Management** - Direct and pre-signed URL uploads to Backblaze B2
- 🎥 **Video Content CRUD** - Complete content management with metadata
- 🏥 **Health Monitoring** - Comprehensive service health checks
- 🚀 **Production Ready** - Security middleware, rate limiting, error handling
- 🌐 **Multi-Cloud Support** - Docker containerized for any cloud provider
- 📊 **Monitoring** - Prometheus metrics and detailed health endpoints

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js with comprehensive middleware
- **Authentication**: Auth0 JWT tokens
- **File Storage**: Backblaze B2 cloud storage
- **Secret Management**: Google Secret Manager (optional)
- **Hosting**: DigitalOcean App Platform (cloud-agnostic)
- **Containerization**: Docker with multi-stage builds

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm 8+
- Auth0 account and application
- Backblaze B2 bucket and credentials

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/nsr-compute/storylofts-backend.git
   cd storylofts-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Test the API**
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/api/docs
   ```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NODE_ENV` | Runtime environment | ✅ |
| `PORT` | Server port | ✅ |
| `AUTH0_DOMAIN` | Auth0 tenant domain | ✅ |
| `AUTH0_AUDIENCE` | Auth0 API identifier | ✅ |
| `B2_APPLICATION_KEY_ID` | Backblaze B2 key ID | ✅ |
| `B2_APPLICATION_KEY` | Backblaze B2 application key | ✅ |
| `B2_BUCKET_ID` | Backblaze B2 bucket ID | ✅ |
| `B2_BUCKET_NAME` | Backblaze B2 bucket name | ✅ |
| `USE_GOOGLE_SECRET_MANAGER` | Enable secret manager | ⭐ |
| `GOOGLE_CLOUD_PROJECT_ID` | GCP project for secrets | ⭐ |

*⭐ = Optional*

## 📡 API Endpoints

### Health & Monitoring
- `GET /health` - Basic health check
- `GET /health/detailed` - Comprehensive service health
- `GET /health/auth0` - Auth0 connectivity check
- `GET /health/storage` - Backblaze B2 status
- `GET /health/secrets` - Secret Manager status
- `GET /health/metrics` - Prometheus metrics

### Upload Management
- `GET /api/upload/url` - Get pre-signed upload URL
- `POST /api/upload/direct` - Direct upload to server
- `POST /api/upload/complete` - Complete upload process
- `GET /api/upload/status/:id` - Get upload status

### Content Management
- `GET /api/content` - List videos (paginated)
- `GET /api/content/:id` - Get specific video
- `PUT /api/content/:id` - Update video metadata
- `DELETE /api/content/:id` - Delete video
- `GET /api/content/user/:userId` - Get user videos

### Documentation
- `GET /api/docs` - API documentation
- `GET /` - API information and endpoints

## 🔐 Authentication

All content and upload endpoints require Auth0 JWT authentication:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://api.storylofts.com/api/content
```

### Required Auth0 Configuration

- **Domain**: Your Auth0 tenant domain
- **Audience**: API identifier for your application
- **Algorithm**: RS256 (default)

## 🏥 Health Monitoring

### Service Dependencies

The API monitors connectivity to:

1. **Auth0** - Authentication service availability
2. **Backblaze B2** - File storage connectivity and authorization
3. **Google Secret Manager** - Secure credential access (if enabled)
4. **Database** - Currently in-memory, PostgreSQL migration planned

### Health Check Response

```json
{
  "success": true,
  "overall": "healthy",
  "timestamp": "2025-06-15T10:30:00.000Z",
  "uptime": 3600000,
  "services": [
    {
      "service": "Auth0",
      "status": "healthy",
      "responseTime": 245,
      "details": {
        "domain": "storylofts.auth0.com",
        "keysCount": 2
      }
    }
  ],
  "summary": {
    "healthy": 4,
    "degraded": 0,
    "unhealthy": 0,
    "total": 4
  }
}
```

## 🐳 Docker Deployment

### Build and Run Locally

```bash
# Build the image
docker build -t storylofts-api .

# Run container
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e AUTH0_DOMAIN=your-domain.auth0.com \
  storylofts-api
```

### Docker Compose

```bash
# Start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f storylofts-api
```

## ☁️ Cloud Deployment

### DigitalOcean App Platform (Current)

1. Connect GitHub repository
2. Configure environment variables
3. Deploy automatically on git push

### Multi-Cloud Support

The API is designed to run anywhere:

- **Railway**: 5-minute deployment
- **Google Cloud Run**: Serverless with auto-scaling
- **AWS ECS/Fargate**: Enterprise container orchestration
- **Fly.io**: Global edge deployment
- **Azure Container Instances**: Microsoft ecosystem

See [deployment documentation](docs/multi-cloud-deployment.md) for detailed guides.

## 🔧 Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run test suite
- `npm run lint` - Lint TypeScript code
- `npm run lint:fix` - Fix linting errors

### Project Structure

```
storylofts-backend/
├── src/
│   ├── config/           # Configuration management
│   ├── middleware/       # Express middleware (auth, etc.)
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic services
│   ├── types/           # TypeScript type definitions
│   └── server.ts        # Main application entry point
├── dist/                # Compiled JavaScript (gitignored)
├── scripts/             # Utility scripts
├── .github/workflows/   # CI/CD pipelines
├── .do/                 # DigitalOcean deployment config
└── docs/                # Additional documentation
```

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Airbnb configuration
- **Prettier**: Automatic code formatting
- **Conventional Commits**: Standardized commit messages

## 🚦 Rate Limiting

- **General API**: 100 requests per 15 minutes
- **Upload endpoints**: 10 uploads per hour
- **Health checks**: 30 requests per minute

## 🔒 Security Features

- **Helmet.js**: Security headers
- **CORS**: Configured for StoryLofts domains
- **JWT Validation**: Auth0 token verification
- **Input Validation**: Express-validator middleware
- **Rate Limiting**: Prevent abuse
- **Error Handling**: Secure error responses

## 📊 Monitoring & Observability

### Built-in Monitoring

- Service health checks
- Response time tracking
- Error rate monitoring
- Uptime tracking

### External Monitoring

Compatible with:
- **Prometheus**: `/health/metrics` endpoint
- **DataDog**: Custom metrics integration
- **Uptime Robot**: Simple HTTP monitoring
- **DigitalOcean Monitoring**: Built-in app metrics

## 🗺️ Roadmap

### Near Term
- [ ] PostgreSQL database migration
- [ ] Advanced file processing (thumbnails, transcoding)
- [ ] Enhanced search and filtering
- [ ] Analytics and usage metrics

### Future Enhancements
- [ ] Multi-region deployment
- [ ] CDN integration for global content delivery
- [ ] Advanced user management
- [ ] Webhook system for integrations
- [ ] GraphQL API layer

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write tests for new features
- Update documentation
- Follow TypeScript/ESLint conventions
- Add health checks for new external services

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [API Docs](https://api.storylofts.com/api/docs)
- **Health Status**: [https://api.storylofts.com/health](https://api.storylofts.com/health)
- **Issues**: [GitHub Issues](https://github.com/nsr-compute/storylofts-backend/issues)

## 🎯 About StoryLofts

StoryLofts is a premium video platform designed for professional creators and discerning viewers. Our mission is to provide elevated creative spaces where stories find their proper home - curated quality over algorithmic noise.

**Live Platform**: [https://storylofts.com](https://storylofts.com)

---

<div align="center">

**Built with ❤️ for the StoryLofts platform**

[Website](https://storylofts.com) • [API](https://api.storylofts.com) • [Documentation](https://api.storylofts.com/api/docs)

</div>
