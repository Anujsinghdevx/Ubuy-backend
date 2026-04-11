# Testing Guide

This document defines the testing strategy, standards, and workflows for the Ubuy backend.

## 1. Objectives

- Protect core business flows from regressions.
- Keep feedback fast for local development.
- Make CI failures actionable and deterministic.
- Maintain confidence in releases through layered testing.

## 2. Testing Strategy

We use a layered approach:

- Unit tests: Validate isolated business logic (services, guards, helpers).
- Smoke tests: Validate critical API flows and integration wiring.
- Optional extended smoke: Validate secondary authenticated flows.

Recommended execution order:

1. Run lint + unit tests on every pull request.
2. Run core smoke tests on pull requests where API/runtime behavior changes.
3. Run full smoke suite nightly or before high-risk releases.

## 3. Current Tooling

- Test runner: Jest
- HTTP assertions: supertest
- NestJS testing utilities: @nestjs/testing
- TypeScript transform: ts-jest

Key configuration files:

- Root scripts: package.json
- Smoke Jest config: test/jest-smoke.json
- Test TypeScript config: tsconfig.test.json

## 4. Test Suites and Commands

### 4.1 Unit Tests

- Run the full local basic quality gate (build + prettier check + unit tests):

```bash
npm run check:local
```

- Run all unit tests:

```bash
npm run test:unit
```

- Watch unit tests while developing:

```bash
npm run test:unit:watch
```

- Unit coverage (enforces baseline thresholds):

```bash
npm run test:unit:cov
```

### 4.2 General Jest

- Run all discovered tests:

```bash
npm test
```

- Watch mode:

```bash
npm run test:watch
```

- Coverage mode:

```bash
npm run test:cov
```

- Debug mode:

```bash
npm run test:debug
```

### 4.3 Smoke Tests

- Core smoke suite (fast PR-friendly checks):

```bash
npm run test:smoke:core
```

- Extended smoke suite (authenticated user flows):

```bash
npm run test:smoke:extended
```

- Full smoke suite:

```bash
npm run test:smoke
```

- CI/nightly aliases:

```bash
npm run test:smoke:ci
npm run test:smoke:nightly
```

## 5. Test Organization

### 5.1 Existing Structure

- Smoke tests:
  - test/smoke/api.smoke-spec.ts
  - test/smoke/user-flows.smoke-spec.ts

### 5.2 Unit Test Placement

Place unit tests next to the implementation file:

- src/modules/auth/auth.service.ts
- src/modules/auth/auth.service.spec.ts

Benefits:

- Easier maintenance and refactoring.
- Faster ownership and review.
- Better feature-level discoverability.

## 6. Unit Test Standards

### 6.1 Naming

- Use "*.spec.ts" suffix.
- Describe behavior, not internals.
- Test names should follow "should <expected behavior> when <condition>".

Example:

```ts
it('should throw BadRequestException when user already exists', async () => {
  // ...
});
```

### 6.2 Structure (AAA)

Use Arrange, Act, Assert structure in every test:

- Arrange: create module, mocks, and inputs.
- Act: call one unit under test.
- Assert: verify output and interactions.

### 6.3 Isolation Rules

- Do not call real external services in unit tests.
- Mock all boundaries:
  - database models
  - queues
  - redis
  - jwt service
  - mail service
  - payment providers
- Keep tests deterministic (no random, no real wall-clock dependency unless mocked).

## 7. NestJS Mocking Patterns

Use TestingModule and explicit provider overrides.

```ts
const moduleRef = await Test.createTestingModule({
  providers: [
    AuthService,
    { provide: UsersService, useValue: usersServiceMock },
    { provide: JwtService, useValue: jwtServiceMock },
    { provide: MailService, useValue: mailServiceMock },
  ],
}).compile();
```

For Mongoose models:

```ts
{ provide: getModelToken(User.name), useValue: userModelMock }
```

For BullMQ queues:

```ts
{ provide: getQueueToken('auctionQueue'), useValue: auctionQueueMock }
```

## 8. Environment Requirements

Smoke tests depend on application runtime integrations. Ensure required environment variables are available:

- MONGO_URI
- REDIS_URL
- JWT_SECRET

Optional variables can affect specific flows (payment redirects, notifications, etc.).

## 9. Coverage and Quality Gates

Coverage should be evaluated primarily for unit tests.

Recommended initial thresholds for unit suites:

- Statements: 70%
- Lines: 70%
- Functions: 70%
- Branches: 60%

Raise thresholds incrementally as test depth improves.

## 10. CI Recommendations

Suggested pull request pipeline:

1. npm ci
2. npm run build
3. npm run prettier:check
4. npm run test:unit

Note: `prettier:check` is currently scoped to workflow files to keep CI stable while the repository transitions to full Prettier compliance.

Suggested nightly pipeline:

1. npm ci
2. npm run test:unit:cov
3. npm run test:smoke

## 11. Flakiness Prevention Checklist

- Avoid shared mutable state across tests.
- Clean up database fixtures in hooks.
- Close app, queue, worker, and db connections in afterAll.
- Use fixed test data where possible.
- Limit timing-sensitive assertions and mock time when needed.

## 12. Troubleshooting

Common issues and quick checks:

- Jest does not find tests:
  - verify file suffix is "*.spec.ts"
  - verify test regex/config scope
- Open handle warnings:
  - ensure queue workers and DB connections are closed
- Authentication test failures:
  - verify JWT_SECRET and token creation mocks
- Redis/Mongo smoke failures:
  - verify MONGO_URI and REDIS_URL availability

## 13. Team Policy

- New business logic must include unit tests.
- Bug fixes should include a regression test that fails before the fix and passes after.
- Keep tests readable, behavior-focused, and fast.

---

Owner: Backend Team

If this guide is updated, keep scripts and examples aligned with package.json and active Jest configs.
