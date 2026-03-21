# Ubuy Backend

A scalable, production-ready backend for **Ubuy** - a real-time auction platform.

---

## Overview
Real-time auction system with live bidding, user management, and scalable architecture.

---

## Tech Stack
- Node.js, NestJS, TypeScript
- MongoDB
- Socket.IO
- Redis (planned)

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
1. User emits `place-bid`
2. Validate bid > currentBid
3. Save bid in DB
4. Update auction
5. Emit `bid-updated` via WebSocket

---

## Features
- JWT Authentication
- Role-based authorization
- Real-time bidding
- Auction lifecycle management

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

## WebSocket Events
- join-auction
- place-bid
- bid-updated
- auction-ended

---

## Author
Anuj Singh

---

## Support
Give a star if you like this project!
