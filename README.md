# LinkedIn Automation
## 1. Project Overview & Objectives

In modern professional life, maintaining a consistent posting schedule on LinkedIn is essential for career development and technical networking. However, students and working professionals frequently struggle with consistency due to academic pressure, work commitments, and project deadlines.

**LinkedIn Automation** is a full-stack web application designed to help users compose, schedule, manage, and automatically publish LinkedIn posts in advance through the official LinkedIn REST API.

### Key Objectives
* **Post Scheduling:** Compose posts (up to 3,000 characters) and select future dates and times for automated publishing.
* **Automated Dispatching:** An autonomous background worker service that periodically scans the database and publishes due posts via the LinkedIn REST API.
* **Queue Management:** Complete lifecycle management allowing users to view, manage, and cancel scheduled posts before dispatch.
* **Real-time Status Tracking:** Real-time visibility into post statuses (`PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`) with detailed error logs for failed dispatches.

---

## 2. System Architecture & Modules

The application is structured into four core modules as defined in the project specification:

### Module Breakdown
1. **Authentication Module (`LinkedInAuthModule`):** Manages user authentication using LinkedIn OAuth 2.0 with state verification. Exchanges authorization codes for access and refresh tokens, maintains user sessions via secure `HttpOnly` cookies, and handles proactive 24-hour token refreshes.
2. **Post Management Module (`PostsModule`):** Provides endpoints to create, list, retrieve, and cancel scheduled posts. Enforces payload validation (character limits up to 3000 chars, valid timestamps).
3. **Scheduler & Dispatcher Module (`SchedulerModule`):** A lightweight background cron service that runs every minute to query due posts, atomically lock records to prevent duplicate execution, and dispatch posts to LinkedIn.
4. **Real-time Event Stream (`EventsModule`):** Server-Sent Events (SSE) channel that notifies the user interface in real time when posts transition through `POST_PROCESSING`, `POST_PUBLISHED`, or `POST_FAILED`.

---

## 3. Database Schema (Prisma & PostgreSQL)

The relational database is hosted on **Supabase Cloud** and managed via **Prisma ORM**:

* **`LinkedInAccount` (User Entity):** Stores user profile details (`userId`, `linkedInId`, `name`, `email`), encrypted OAuth access and refresh tokens, token expiration timestamps, and account status (`ACTIVE`, `EXPIRED`, `DISCONNECTED`).
* **`ScheduledPost` (Post Entity):** Stores the scheduled commentary text, target execution time (`scheduledTime`), publishing status (`PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`), target author URN, returned `linkedInPostId`, and error diagnostics (`failureReason`).
* **`LinkedInOrganization` (Company Page Entity):** Stores company pages administered by the user for multi-target publishing.

### Key Database Indexes
* `ScheduledPost(status, scheduledTime)` — Optimizes the recurring 1-minute scheduler query.
* `ScheduledPost(userId, scheduledTime)` — Delivers pre-sorted user dashboard queries.

---

## 4. Security Mechanisms

* **OAuth 2.0 Protocol:** No user passwords are stored or handled. Authentication is delegated directly to LinkedIn's official OAuth servers with unique state hashes to prevent CSRF.
* **HttpOnly Session Cookies:** User session identifiers are delivered via `HttpOnly`, `SameSite: Lax` cookies (`la_session`), preventing client-side script access and XSS-based session hijacking.
* **SQL Injection Prevention:** All database operations use Prisma ORM parameterized queries.
* **Input Validation & Sanitization:** Strict class-validator DTO guards prevent malformed payloads and buffer overruns.
* **Timing-Safe Webhook Protection:** Scheduler webhook triggers utilize `crypto.timingSafeEqual` constant-time verification.

---

## 5. Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/rahul-shaw18/linkedin-automation.git
cd linkedin-automation
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Copy `.example.env` to `.env` and configure your credentials:
```bash
cp .example.env .env
```

Key configuration parameters:
```env
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"

LINKEDIN_CLIENT_ID="your_linkedin_client_id"
LINKEDIN_CLIENT_SECRET="your_linkedin_client_secret"
LINKEDIN_REDIRECT_URI="http://localhost:3000/auth/linkedin/callback"

CRON_SECRET_KEY="your_secure_cron_key"
FRONTEND_URL="http://localhost:4200"
PORT=3000
```

### 4. Database Setup
```bash
npx prisma db push
npx prisma generate
```

### 5. Run the Application
```bash
# Development Mode (Hot Reload)
npm run start:dev

# Production Build & Run
npm run build
npm run start:prod
```

* **Swagger API Documentation:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
* **Health Check Probe:** [http://localhost:3000/health](http://localhost:3000/health)
* **Prisma Database Studio:** `npm run prisma:studio` ([http://localhost:5555](http://localhost:5555))

---

## 6. License & Acknowledgments

This project is developed for academic evaluation as part of the MCA degree program at **Uttaranchal University, Dehradun**.

Licensed under the [MIT License](LICENSE).
