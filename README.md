# LinkedIn Post Scheduler & Automation Engine (Backend)

[![NestJS](https://img.shields.io/badge/NestJS-12.x-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-5.x-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-316192?logo=postgresql&logoColor=white)](https://supabase.com/)
[![LinkedIn API](https://img.shields.io/badge/LinkedIn-Posts%20API-0A66C2?logo=linkedin&logoColor=white)](https://learn.microsoft.com/en-us/linkedin/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A high-performance, production-ready NestJS REST API backend built on the **Fastify** engine, integrated with **Supabase (PostgreSQL)** via **Prisma ORM**. The platform handles LinkedIn OAuth 2.0 authentication, secure session management with `HttpOnly` cookies, proactive 24-hour token refreshes, post scheduling for personal profiles and company pages, and automated execution via a bounded concurrent task scheduler and Server-Sent Events (SSE).

---

## Architecture Overview

```
                      ┌──────────────────────────────────────┐
                      │    Client / Frontend (Angular 22)    │
                      └──────────────────┬───────────────────┘
                                         │
             ┌───────────────────────────┼───────────────────────────┐
             │                           │                           │
             ▼                           ▼                           ▼
    [ OAuth & Session ]           [ Post Scheduling ]        [ Scheduled Trigger ]
    GET  /auth/linkedin/login-url POST /posts/schedule       POST /api/trigger-posts
    GET  /auth/linkedin/callback  GET  /posts/user/:userId   (Protected by X-Cron-Secret)
    GET  /auth/linkedin/me        GET  /posts/events/:userId (Real-time SSE stream)
             │                           │                           │
             └───────────────────────────┼───────────────────────────┘
                                         ▼
                      ┌──────────────────────────────────────┐
                      │      Fastify NestJS 12 Engine        │
                      │  - Gzip / Deflate Compression        │
                      │  - HttpOnly Cookie Session Auth      │
                      │  - Fail-Fast DTO Validation Pipe     │
                      └──────────────────┬───────────────────┘
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │    Prisma ORM & Supabase Postgres    │
                      │  - LinkedInAccount (tokens, status)  │
                      │  - ScheduledPost (composite indexes) │
                      │  - LinkedInOrganization (pages)      │
                      └──────────────────┬───────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
         [ In-Process Cron Job ]                   [ External Webhook Ping ]
        @Cron(EVERY_MINUTE)                        cron-job.org / Render
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         │
                                         ▼
                         1. Query due PENDING posts (Batch: 50)
                         2. Atomic Lock: status -> PROCESSING
                         3. Proactive Token Refresh (if <24h)
                         4. Bounded Parallelism (5 concurrent workers)
                         5. Publish via LinkedIn REST API (/rest/posts)
                         6. Update status -> PUBLISHED / FAILED
                         7. Emit Real-time SSE Event to Frontend
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │       LinkedIn Posts REST API        │
                      │        (/rest/posts v202610)         │
                      └──────────────────────────────────────┘
```

---

## Core Features & Modules

### 1. LinkedIn OAuth 2.0 & Session Management (`LinkedInAuthModule`)
- **Direct Browser Redirect & Exchange:** Handles OAuth callback, exchanges authorization code for access and refresh tokens, maps member identifier, and stores credentials in PostgreSQL.
- **Secure `HttpOnly` Cookies:** Sets `SameSite: Lax`, `HttpOnly` session cookie (`la_session`) preventing XSS token theft.
- **Proactive Token Refresh:** Evaluates token expiration prior to publishing. If an access token is expired or within 24 hours of expiry, it automatically uses the refresh token to obtain fresh credentials.
- **Company Pages / Organizations:** Automatically queries and provisions company pages that the user administers for multi-target publishing.

### 2. LinkedIn Post Publishing (`LinkedInPostModule`)
- Formats request payloads adhering strictly to LinkedIn Posts API specifications (`https://api.linkedin.com/rest/posts`).
- Attaches required protocol headers: `LinkedIn-Version`, `X-Restli-Protocol-Version: 2.0.0`, and Bearer tokens.
- Supports publishing to both **Personal Profile feeds** (`urn:li:person:...`) and **Company / Organization pages** (`urn:li:organization:...`).
- Incorporates `AbortSignal.timeout(15000)` to prevent worker socket hangs.

### 3. High-Throughput Scheduler (`SchedulerModule`)
- **Automated Cron Engine:** Evaluates due posts every minute using `@nestjs/schedule`.
- **Atomic Database Locking:** Uses conditional updates (`where: { id, status: 'PENDING' }, data: { status: 'PROCESSING' }`) guaranteeing zero duplicate executions across concurrent cron cycles or clustered workers.
- **Bounded Concurrency:** Executes publishing in parallel worker chunks (`CONCURRENCY_LIMIT = 5` via `Promise.allSettled`) delivering a 5x throughput increase.
- **Webhook Endpoint (`POST /api/trigger-posts`):** Authenticated with `crypto.timingSafeEqual` header check (`X-Cron-Secret`), enabling external heartbeat monitors (e.g. cron-job.org) to trigger processing on free or serverless tiers.

### 4. Real-Time Server-Sent Events (`EventsModule`)
- Exposes persistent HTTP event streams (`GET /posts/events/:userId`) via RxJS.
- Emits real-time lifecycle notifications (`POST_PROCESSING`, `POST_PUBLISHED`, `POST_FAILED`) to update dashboard analytics instantly.
- Includes a 25-second keepalive heartbeat ping to prevent connection drops by reverse proxies.

---

## Tech Stack

| Category | Technology | Description |
| :--- | :--- | :--- |
| **Framework** | [NestJS 12](https://nestjs.com/) | Modular Node.js framework with TypeScript |
| **HTTP Engine** | [Fastify 5](https://fastify.dev/) | High-performance, low-overhead HTTP platform |
| **Database** | [PostgreSQL (Supabase)](https://supabase.com/) | Relational database with PgBouncer connection pooling |
| **ORM** | [Prisma 5.x](https://www.prisma.io/) | Type-safe query builder and schema management |
| **Task Scheduling** | `@nestjs/schedule` | In-process cron scheduler |
| **API Docs** | `@nestjs/swagger` | OpenAPI Swagger documentation at `/api/docs` |
| **Compression** | `@fastify/compress` | Gzip & deflate response compression |
| **Cookies** | `@fastify/cookie` | Fastify HttpOnly cookie parser |
| **Validation** | `class-validator`, `class-transformer` | Strict schema validation with fail-fast execution |

---

## Getting Started

### 1. Prerequisites
- **Node.js** >= 20.x
- **npm** >= 10.x
- A **Supabase PostgreSQL** database
- A **LinkedIn Developer Application** with `Share on LinkedIn` or `Sign In with LinkedIn using OpenID Connect` enabled

### 2. Installation
```bash
git clone <your-repo-url>
cd linkedin-automation
npm install
```

### 3. Environment Configuration
Copy `.example.env` to `.env` and fill in your values:

```bash
cp .example.env .env
```

```env
# Database
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"

# LinkedIn OAuth 2.0
LINKEDIN_CLIENT_ID="your_linkedin_client_id"
LINKEDIN_CLIENT_SECRET="your_linkedin_client_secret"
LINKEDIN_REDIRECT_URI="http://localhost:3000/auth/linkedin/callback"
LINKEDIN_SCOPES="openid profile email w_member_social"
LINKEDIN_API_VERSION="202610"

# Application
PORT=3000
NODE_ENV=development
FRONTEND_URL="http://localhost:4200"

# Scheduler Webhook Secret
CRON_SECRET_KEY="your_secure_random_string"

# Simulation Flag for Company Pages during testing
ALLOW_SIMULATED_ORG_POST="true"
```

### 4. Database Setup
```bash
# Push schema and composite indexes to PostgreSQL
npx prisma db push

# Generate Prisma Client
npx prisma generate
```

### 5. Running the Application
```bash
# Development mode with hot-reload
npm run start:dev

# Production build and run
npm run build
npm run start:prod
```

### 6. Interactive API Documentation
Once running, open:
- 📚 **Swagger UI:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- 📄 **OpenAPI Spec:** [http://localhost:3000/api/docs-json](http://localhost:3000/api/docs-json)
- 🩺 **Health Check:** [http://localhost:3000/health](http://localhost:3000/health)

---

## API Reference

### Authentication (`/auth/linkedin`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/auth/linkedin/login-url` | Generate LinkedIn OAuth authorization URL |
| `GET` | `/auth/linkedin/callback` | Browser redirect callback from LinkedIn OAuth screen |
| `POST` | `/auth/linkedin/callback` | Programmatic authorization code exchange |
| `GET` | `/auth/linkedin/me` | Fetch active session from `la_session` cookie |
| `POST` | `/auth/linkedin/logout` | Clear session cookie |
| `GET` | `/auth/linkedin/accounts/:userId` | List connected LinkedIn accounts |
| `DELETE` | `/auth/linkedin/accounts/:accountId` | Disconnect LinkedIn account |
| `GET` | `/auth/linkedin/organizations/:userId` | List accessible company pages |
| `POST` | `/auth/linkedin/organizations/:userId` | Add custom company page |

### Scheduled Posts (`/posts`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/posts/schedule` | Schedule a new post |
| `GET` | `/posts/user/:userId` | Retrieve posts for a user with pagination (`limit`, `offset`) |
| `GET` | `/posts/:postId` | Get post details and execution failure log |
| `DELETE` | `/posts/:postId` | Cancel/delete a pending post |
| `POST` | `/posts/:postId/retry` | Reschedule a failed post |
| `GET` | `/posts/events/:userId` | Server-Sent Events (SSE) real-time stream |

### Webhooks & System (`/api`, `/health`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/trigger-posts` | Webhook trigger for scheduler (Requires `X-Cron-Secret`) |
| `GET` | `/health` | System health probe (5s TTL database cache) |

---

## Database Management
```bash
# Launch Prisma Studio database GUI (Port 5555)
npm run prisma:studio
```

---

## License
MIT
