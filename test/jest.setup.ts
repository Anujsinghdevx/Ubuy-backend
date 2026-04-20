import { afterAll, beforeAll, jest } from '@jest/globals';

const BULLMQ_EVICTION_WARNING =
  'IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"';

const originalWarn = console.warn;

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const [first] = args;
    if (
      typeof first === 'string' &&
      first.includes(BULLMQ_EVICTION_WARNING)
    ) {
      return;
    }

    originalWarn(...(args as Parameters<typeof console.warn>));
  });
});

afterAll(() => {
  const warnMock = console.warn as unknown as { mockRestore?: () => void };
  warnMock.mockRestore?.();
});
