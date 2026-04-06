# Propflow Backend

Real estate sales automation platform — Node.js / Express / TypeScript / Prisma API server.

## Stack

| Layer         | Technology                      |
| ------------- | ------------------------------- |
| Runtime       | Node.js 20 + TypeScript         |
| Framework     | Express 4                       |
| ORM           | Prisma 5 + PostgreSQL 16        |
| Auth          | Better Auth (JWT, multi-tenant) |
| Queue / Cache | BullMQ + Redis 7                |
| AI            | Groq SDK (LLaMA 3.3 70B)        |
| Comms         | Twilio (WhatsApp Business, SMS) |
| Email         | Resend                          |
| Storage       | Cloudflare R2                   |

## Project structure

```
src/
├── config/          # env validation, DB client, Redis client
├── middleware/       # auth (Better Auth), error handler
├── modules/
│   ├── leads/        # lead CRUD, pipeline stage transitions
│   ├── communications/  # send messages, inbound webhook
│   ├── inventory/    # projects, units, bookings
│   ├── visits/       # site visit scheduling + outcomes
│   ├── analytics/    # funnel, team performance, source ROI
│   └── notifications/   # follow-up tasks
├── queues/           # BullMQ workers — AI scoring, messaging, scheduler
├── services/
│   ├── ai.service.ts        # Groq: lead scoring + follow-up generation
│   └── communication.service.ts  # Twilio send + inbound processing
├── types/            # shared TypeScript interfaces
├── utils/            # Winston logger
├── routes/           # top-level router
├── app.ts            # Express app setup
└── server.ts         # entry point, graceful shutdown
prisma/
├── schema.prisma     # full multi-tenant schema
└── seed.ts           # demo data
```

## Quick start

### 1. Prerequisites

- Node.js 20+
- Docker (for local Postgres + Redis)
- Twilio account (for WhatsApp/SMS)
- Groq API key

### 2. Install dependencies

```bash
npm install
```

### 3. Start local services

```bash
docker compose up -d
```

### 4. Configure environment

```bash
cp .env.example .env
# Fill in your API keys in .env
```

The `DATABASE_URL` for local Docker is:

```
postgresql://propflow:propflow_dev@localhost:5432/propflow
```

### 5. Run migrations and seed

```bash
npm run db:migrate       # run Prisma migrations
npm run db:generate      # generate Prisma client
npm run db:seed          # seed demo data
```

### 6. Start the dev server

```bash
npm run dev
```

API is live at `http://localhost:4000/api/v1`

### 7. (Optional) Open Prisma Studio

```bash
npm run db:studio
```

## API reference

### Auth

All endpoints require a valid Better Auth session. Obtain a session token via `POST /api/auth/sign-in/email`.

Every request to `/api/v1/*` must include:

```
Cookie: better-auth.session_token=<token>
```

### Core endpoints

| Method | Path                                     | Description                        |
| ------ | ---------------------------------------- | ---------------------------------- |
| GET    | /api/v1/health                           | Health check                       |
| GET    | /api/v1/leads                            | List leads (filtered, paginated)   |
| POST   | /api/v1/leads                            | Create lead                        |
| GET    | /api/v1/leads/:id                        | Lead detail with full history      |
| PATCH  | /api/v1/leads/:id                        | Update lead / change stage         |
| DELETE | /api/v1/leads/:id                        | Soft delete lead                   |
| POST   | /api/v1/communications/send              | Send WhatsApp/SMS/email            |
| POST   | /api/v1/communications/generate-followup | AI follow-up generation            |
| GET    | /api/v1/inventory/projects               | List projects                      |
| GET    | /api/v1/inventory/projects/:id/units     | Unit availability matrix           |
| POST   | /api/v1/inventory/bookings               | Create booking (atomic)            |
| GET    | /api/v1/visits                           | List site visits                   |
| POST   | /api/v1/visits                           | Schedule visit + send confirmation |
| PATCH  | /api/v1/visits/:id/outcome               | Record visit outcome               |
| GET    | /api/v1/analytics/overview               | Dashboard KPIs                     |
| GET    | /api/v1/analytics/funnel                 | Conversion funnel                  |
| GET    | /api/v1/analytics/team                   | Agent performance                  |
| GET    | /api/v1/analytics/sources                | Lead source ROI                    |
| GET    | /api/v1/follow-ups                       | Follow-up task list                |
| POST   | /api/v1/follow-ups/ai-generate           | AI-generate + auto-schedule task   |

### Webhooks (no auth — Twilio signed)

| Method | Path                     | Description              |
| ------ | ------------------------ | ------------------------ |
| POST   | /webhooks/twilio/inbound | Inbound WhatsApp / SMS   |
| POST   | /webhooks/twilio/status  | Delivery status callback |

## Multi-tenancy

Every database table has a `tenantId` column. The auth middleware resolves `tenantId` from the user's JWT and scopes all queries automatically. Agents additionally see only their own assigned leads.

## Queue jobs

| Queue           | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `ai-score`      | Async lead scoring via Groq after new lead / inbound message |
| `communication` | Outbound message sending via Twilio                          |
| `follow-up`     | Scheduled follow-up task executor (polls every 60s)          |

## Environment variables

See `.env.example` for the full list.

✨ Seed complete!
Tenant subdomain: demo
Admin email: admin@demo.com
