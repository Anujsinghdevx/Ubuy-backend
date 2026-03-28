# Ubuy Backend

A scalable, production-ready backend for **Ubuy** - a real-time auction platform.

---

## Overview
Real-time auction system with live bidding, user management, queue-based auction ending, and health monitoring.

---

## Tech Stack
- Node.js, NestJS, TypeScript
- MongoDB
- Socket.IO
- Redis (ioredis + Socket.IO Redis adapter)
- BullMQ (auction lifecycle jobs)

---

## High Level Design (HLD)

```
Client (Web / Mobile)
        |
   API Gateway (NestJS)
        |
 ---------------------------------
 | Auth | Auction | Bidding | WS |
 ---------------------------------
        |
   -------------------------
   | MongoDB | Redis Cache |
   -------------------------
        |
   Kafka (Future)
```

---

## Low Level Design (LLD)

### Auction Entity
```
id: string
title: string
basePrice: number
currentBid: number
ownerId: string
endTime: Date
```

### Bid Entity
```
id: string
auctionId: string
userId: string
amount: number
timestamp: Date
```

### Bid Flow
1. User emits `placeBid`
2. Validate bid > currentBid
3. Save bid in DB
4. Update auction
5. Emit `newBid` via WebSocket

---

## Features
- JWT Authentication
- Role-based authorization
- Real-time bidding
- Auction lifecycle management
- Health checkpoint endpoint for backend, MongoDB, Redis, config, and memory

---

## Current Status
- Implemented modules: Auth, Users, Auctions, Bids, Queue, Health
- Root endpoint (`GET /`) returns runtime service status
- Health endpoint (`GET /health`) returns dependency checks and readiness

---

## System Design Explanation

- **Modular Monolith** -> Easily convertible to microservices
- **WebSockets** -> Real-time bidding updates
- **Redis** -> Caching + scaling sockets
- **Kafka (Future)** -> Event-driven architecture

### Scalability Strategy
- Stateless backend
- Horizontal scaling
- Redis adapter for WebSockets

---

## Project Structure

```
src/
|-- common/
|-- modules/
|-- config/
|-- database/
`-- main.ts
```

---

## Setup

```bash
git clone https://github.com/Anujsinghdevx/Ubuy-backend.git
cd ubuy-backend
npm install
npm run start:dev
```

---

## API Quick Check
- `GET /` -> service runtime status
- `GET /health` -> backend, MongoDB, Redis, config, memory checks
- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/verify-email`
- `GET /auth/me` (JWT required)
- `POST /auctions` (JWT required)
- `GET /auctions`
- `GET /auctions/active`
- `GET /auctions/:id`

---

## WebSocket Events
- joinAuction
- leaveAuction
- placeBid
- newBid
- auctionEnded

---

## Author
Anuj Singh

---

## Support
Give a star if you like this project!
