# StoryLofts Backend API

> **A premium video content management platform for professional creators**

StoryLofts ContentHive is a professional-grade video content management API designed for creators who value quality over quantity. Think "Vimeo for professionals, not YouTube for everyone" - focusing on curated storytelling and premium content experiences.

## 🚀 Live Services

- **API Endpoint**: [https://api.storylofts.com](https://api.storylofts.com)
- **Platform**: [https://storylofts.com](https://storylofts.com)
- **API Documentation**: [https://api.storylofts.com/api/docs](https://api.storylofts.com/api/docs)
- **Health Status**: [https://api.storylofts.com/health](https://api.storylofts.com/health)

## ✨ Key Features

- 🔐 **Secure Authentication** - Auth0 JWT integration with RS256 algorithm
- 📁 **Advanced File Management** - Direct and pre-signed URL uploads to Backblaze B2
- 🎥 **Video Content CRUD** - Complete content management with rich metadata
- 🏥 **Comprehensive Health Monitoring** - Multi-service health checks and metrics
- 🚀 **Production Ready** - Security middleware, rate limiting, and error handling
- 🌐 **Multi-Cloud Support** - Docker containerized for deployment anywhere
- 📊 **Monitoring & Metrics** - Prometheus integration and detailed health endpoints

## 🛠 Tech Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Node.js 18+ with TypeScript |
| **Framework** | Express.js with comprehensive middleware |
| **Authentication** | Auth0 JWT tokens (RS256) |
| **File Storage** | Backblaze B2 cloud storage |
| **Secret Management** | Google Secret Manager (optional) |
| **Hosting** | DigitalOcean App Platform (cloud-agnostic) |
| **Containerization** | Docker with multi-stage builds |
| **Monitoring** | Prometheus metrics |

## 📋 Prerequisites

- Node.js 18+ and npm 8+
- Auth0 account and application configured
- Backblaze B2 bucket and credentials
- (Optional) Google Cloud Project for Secret Manager

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/nsr-compute/storylofts-backend.git
cd storylofts-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials (see Environment Variables section)
```

### 3. Start Development Server

```bash
npm run dev
```

### 4. Verify Installation

```bash
# Check API health
curl http://localhost:3000/health

# View API documentation
curl http://localhost:3000/api/docs
```

## 🔧 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Runtime environment (development/production) | ✅ | - |
| `PORT` | Server port | ✅ | 3000 |
| `AUTH0_DOMAIN` | Auth0 tenant domain | ✅ | - |
| `AUTH0_AUDIENCE` | Auth0 API identifier | ✅ | - |
| `B2_APPLICATION_KEY_ID` | Backblaze B2 key ID | ✅ | - |
| `B2_APPLICATION_KEY` | Backblaze B2 application key | ✅ | - |
| `B2_BUCKET_ID` | Backblaze B2 bucket ID | ✅ | - |
| `B2_BUCKET_NAME` | Backblaze B2 bucket name | ✅ | - |
| `USE_GOOGLE_SECRET_MANAGER` | Enable Google Secret Manager | ⭐ | false |
| `GOOGLE_CLOUD_PROJECT_ID` | GCP project for secrets | ⭐ | - |

*⭐ = Optional*

## 📡 API Endpoints

### Health & Monitoring

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Basic health check |
| `GET /health/detailed` | Comprehensive service health |
| `GET /health/auth0` | Auth0 connectivity check |
| `GET /health/storage` | Backblaze B2 status |
| `GET /health/secrets` | Secret Manager status |
| `GET /health/metrics` | Prometheus metrics |

### File Upload Management

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/upload/url` | GET | Get pre-signed upload URL | ✅ |
| `/api/upload/direct` | POST | Direct upload to server | ✅ |
| `/api/upload/complete` | POST | Complete upload process | ✅ |
| `/api/upload/status/:id` | GET | Get upload status | ✅ |

### Video Content Management

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/content` | GET | List videos (paginated) | ✅ |
| `/api/content/:id` | GET | Get specific video | ✅ |
| `/api/content/:id` | PUT | Update video metadata | ✅ |
| `/api/content/:id` | DELETE | Delete video | ✅ |
| `/api/content/user/:userId` | GET | Get user videos | ✅ |

### Documentation & Information

| Endpoint | Description |
|----------|-------------|
| `GET /api/docs` | Interactive API documentation |
| `GET /` | API information and endpoints |

## 🔐 Authentication

All content and upload endpoints require Auth0 JWT authentication:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://api.storylofts.com/api/content
```

### Auth0 Configuration

- **Domain**: Your Auth0 tenant domain
- **Audience**: API identifier for your application
- **Algorithm**: RS256 (default for security)

## 🏥 Health Monitoring

The API continuously monitors connectivity to all external services:

- **Auth0** - Authentication service availability
- **Backblaze B2** - File storage connectivity and authorization
- **Google Secret Manager** - Secure credential access (if enabled)
- **Database** - Currently in-memory, PostgreSQL migration planned

### Sample Health Response

```json
{
  "success": true,
  "overall": "healthy",
  "timestamp": "2025-06-20T10:30:00.000Z",
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

### Build and Run

```bash
# Build the image
docker build -t storylofts-api .

# Run container
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e AUTH0_DOMAIN=your-domain.auth0.com \
  -e AUTH0_AUDIENCE=your-api-audience \
  storylofts-api
```

### Docker Compose

```bash
# Start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f storylofts-api
```

## ☁️ Multi-Cloud Deployment

The API is designed to run on any cloud platform:

| Platform | Deployment Time | Use Case |
|----------|-----------------|----------|
| **DigitalOcean App Platform** | 5 minutes | Current production hosting |
| **Railway** | 5 minutes | Rapid prototyping |
| **Google Cloud Run** | 10 minutes | Serverless auto-scaling |
| **AWS ECS/Fargate** | 15 minutes | Enterprise container orchestration |
| **Fly.io** | 10 minutes | Global edge deployment |
| **Azure Container Instances** | 15 minutes | Microsoft ecosystem |

### Quick DigitalOcean Deployment

1. Connect GitHub repository to DigitalOcean
2. Configure environment variables in the dashboard
3. Deploy automatically on git push

See [deployment documentation](docs/multi-cloud-deployment.md) for detailed platform-specific guides.

## 📁 Project Structure

```
storylofts-backend/
├── src/
│   ├── config/           # Configuration management
│   ├── middleware/       # Express middleware (auth, rate limiting, etc.)
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic services
│   ├── types/           # TypeScript type definitions
│   └── server.ts        # Main application entry point
├── dist/                # Compiled JavaScript (gitignored)
├── scripts/             # Utility scripts
├── .github/workflows/   # CI/CD pipelines
├── .do/                 # DigitalOcean deployment config
├── docs/                # Additional documentation
├── docker-compose.yml   # Local development setup
├── Dockerfile           # Production container
└── package.json         # Dependencies and scripts
```

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Start production server |
| `npm test` | Run test suite |
| `npm run lint` | Lint TypeScript code |
| `npm run lint:fix` | Fix linting errors automatically |

## 🛡️ Security Features

### Rate Limiting

- **General API**: 100 requests per 15 minutes
- **Upload endpoints**: 10 uploads per hour
- **Health checks**: 30 requests per minute

### Security Middleware

- **Helmet.js**: Comprehensive security headers
- **CORS**: Configured for StoryLofts domains
- **JWT Validation**: Auth0 token verification with RS256
- **Input Validation**: Express-validator middleware
- **Error Handling**: Secure error responses without sensitive data exposure

## 📊 Monitoring & Observability

### Built-in Metrics

- Service health status monitoring
- Response time tracking across all endpoints
- Error rate monitoring and alerting
- Application uptime tracking
- External service dependency monitoring

### Integration Options

| Platform | Endpoint/Method | Description |
|----------|-----------------|-------------|
| **Prometheus** | `/health/metrics` | Standard metrics endpoint |
| **DataDog** | Custom integration | Advanced APM and logging |
| **Uptime Robot** | `/health` | Simple HTTP monitoring |
| **DigitalOcean Monitoring** | Built-in | Native app metrics |

## 🚧 Development Standards

### Code Quality

- **TypeScript**: Strict mode enabled for type safety
- **ESLint**: Airbnb configuration for consistent code style
- **Prettier**: Automatic code formatting
- **Conventional Commits**: Standardized commit messages

### Testing Standards

- Write comprehensive tests for new features
- Maintain test coverage above 80%
- Include integration tests for external services
- Add health checks for new external dependencies

## 📈 Roadmap

### Immediate (Q3 2025)

- [ ] PostgreSQL database migration from in-memory storage
- [ ] Enhanced search and filtering capabilities
- [ ] Advanced file processing (thumbnails, transcoding)
- [ ] Analytics and usage metrics dashboard

### Medium-term (Q4 2025)

- [ ] Multi-region deployment strategy
- [ ] CDN integration for global content delivery
- [ ] Advanced user management and permissions
- [ ] Webhook system for third-party integrations

### Long-term (2026)

- [ ] GraphQL API layer alongside REST
- [ ] Machine learning-powered content recommendations
- [ ] Advanced video analytics and insights
- [ ] Enterprise SSO integration beyond Auth0

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes following our coding standards
4. Write tests for new functionality
5. Update documentation as needed
6. Commit using conventional commit format: `git commit -m 'feat: add amazing feature'`
7. Push to your branch: `git push origin feature/amazing-feature`
8. Open a Pull Request with a clear description

### Development Guidelines

- Follow TypeScript and ESLint conventions
- Write comprehensive tests for new features
- Update documentation for API changes
- Add health checks for new external services
- Ensure all CI/CD checks pass

### Code Review Process

- All changes require review by at least one maintainer
- Automated tests must pass
- Security review for authentication/authorization changes
- Performance review for high-traffic endpoints

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for complete details.

## 🔗 Links & Resources

- **🌐 Platform**: [StoryLofts](https://storylofts.com)
- **📖 API Documentation**: [Interactive Docs](https://api.storylofts.com/api/docs)
- **🏥 Health Dashboard**: [Live Status](https://api.storylofts.com/health)
- **🐛 Bug Reports**: [GitHub Issues](https://github.com/nsr-compute/storylofts-backend/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/nsr-compute/storylofts-backend/discussions)

## 🎯 About StoryLofts

StoryLofts is a premium video platform designed for professional creators and discerning viewers. Our mission is to provide elevated creative spaces where stories find their proper home - prioritizing curated quality over algorithmic noise.

Unlike mass-market platforms, StoryLofts focuses on:

- **Quality over Quantity**: Curated content from verified professional creators
- **Premium Experience**: Ad-free, distraction-free viewing environment
- **Creator-Centric**: Fair monetization and comprehensive analytics
- **Community**: Meaningful connections between creators and audiences

---

**Built with ❤️ for the StoryLofts platform**

*[Website](https://storylofts.com) • [API](https://api.storylofts.com) • [Documentation](https://api.storylofts.com/api/docs)*
