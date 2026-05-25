# ARCHITECTURE — Ubuy Backend (one page)

## Overview
Ubuy is a modular NestJS backend powering real-time auctions, bidding, payments and notifications. The design targets a modular-monolith that can be split into microservices when needed.

## Core Components
- API: NestJS controllers and services (versioned under `/v1`).
- Realtime: Socket.IO gateways with a Redis adapter for cross-instance event fan-out.
- Persistence: MongoDB (Mongoose) for domain data (auctions, users, bids, payments).
- Jobs: BullMQ workers for auction lifecycle (end-auction, payment windows, retries).
- Cache/Coordination: Redis for ephemeral state, socket scaling, and simple locks.
- Observability: middleware + metrics service; Swagger and Bull dashboard exposed as admin tools when enabled.

## System Diagram

```mermaid
flowchart TB
	subgraph Client[Client Applications]
		WEB[Web UI]
		MOB[Mobile UI]
	end

	subgraph API[Backend (NestJS)]
		AUTH[Auth Module]
		AUC[Auctions Module]
		BID[Bids Module]
		PAY[Payments Module]
		NOTIF[Notifications Module]
		UPLOAD[Uploads Module]
		WS[Socket Gateway]
		Q[Queue Workers (BullMQ)]
	end

	subgraph Data[Data & Infra]
		MDB[(MongoDB)]
		REDIS[(Redis)]
	end

	subgraph External[External Services]
		CASHFREE[Cashfree]
		CLOUDINARY[Cloudinary]
		EMAIL[Email Provider]
	end

	WEB --> AUTH
	WEB --> AUC
	WEB --> BID
	WEB --> PAY
	WEB --> NOTIF
	WEB --> UPLOAD

	MOB --> AUTH
	MOB --> AUC
	MOB --> BID
	MOB --> PAY
	MOB --> NOTIF

	BID --> WS
	WS --> REDIS

	AUTH --> MDB
	AUC --> MDB
	BID --> MDB
	PAY --> MDB
	NOTIF --> MDB

	Q --> REDIS
	Q --> MDB

	PAY --> CASHFREE
	UPLOAD --> CLOUDINARY
	AUTH --> EMAIL
```

## Key Data Flows

### 1) Bid placement (happy path)
```mermaid
sequenceDiagram
	participant U as User
	participant UI as Client UI
	participant API as Auctions Controller
	participant B as Bids Service
	participant DB as MongoDB
	participant R as Redis Adapter
	participant WS as WebSocket Gateway

	U->>UI: Enter bid amount
	UI->>API: POST /v1/auctions/{id}/bids
	API->>B: validate user and bid amount
	B->>DB: read auction and current highest bid
	B->>DB: write new bid and update auction
	DB-->>B: updated auction state
	B->>WS: publish bid update event
	WS->>R: fan-out across instances
	WS-->>UI: newBid event
	UI-->>U: Show latest bid and leaderboard
```

### 2) Auction end and payment window
```mermaid
sequenceDiagram
	participant Q as BullMQ Worker
	participant A as Auctions Service
	participant DB as MongoDB
	participant N as Notifications
	participant P as Payments Service
	participant CF as Cashfree

	Q->>A: Process auction end job
	A->>DB: Mark auction ended and resolve winner
	A->>N: Notify winner and seller
	A->>P: Create payment link for winner
	P->>CF: Request payment link
	CF-->>P: linkId and payment URL
	P->>DB: Store payment metadata and expiry
	P->>N: Send payment pending notification
```

## Scalability & Reliability
- Stateless API nodes: scale horizontally behind a load balancer.
- Redis adapter for Socket.IO: guarantees event distribution across instances.
- Job-driven lifecycle: BullMQ workers make auction close/retry logic resilient and observable.
- Data consistency: prefer atomic updates and idempotent job handlers; tune `MONGO_MAX_POOL_SIZE` for concurrency.

## Security & Operational Notes
- Protect `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, and other secrets in a secrets manager and rotate regularly.
- Expose admin tools (`/docs`, `/admin/queues`) only when `ENABLE_ADMIN_TOOLS=true` and behind access control in production.
- Add alerts for queue failure rates, high job retry counts, and unusually high bid rates.

## Failure Modes & Mitigations
- Concurrency races on bids: use optimistic writes, re-checks, and reconciliation jobs.
- Stalled or lost jobs: persist metadata, enable retries and dead-letter handling, and monitor stalled jobs.
- Socket disconnects: implement client reconnect and light state-sync endpoints to recover late clients.

## Demo Checklist
- Start local infra (Mongo + Redis), run `npm run demo:start`, and open `http://localhost:8080`.
- Seed auctions (`npm run demo:start` includes seeding) and trigger concurrent bids with `demo-runner` or the load-test scripts.
- Verify `http://localhost:8080/health`, `http://localhost:8080/docs`, and `http://localhost:8080/admin/queues` (with `ENABLE_ADMIN_TOOLS=true`).

