import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const auctionsPath = __ENV.AUCTIONS_PATH || '/v1/auctions?limit=20&page=1&includeMeta=false&compact=true';
const healthPath = __ENV.HEALTH_PATH || '/health';

const errorCounter = new Counter('app_errors');

export const options = {
  scenarios: {
    spike_test: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '30s', target: 300 },
        { duration: '1m', target: 10 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{endpoint:auctions-list}': ['p(95)<1500'],
    app_errors: ['count<500'],
  },
};

export function setup() {
  const healthRes = http.get(`${baseUrl}${healthPath}`);
  check(healthRes, {
    'health endpoint is 2xx': (r) => r.status >= 200 && r.status < 300,
  });
}

export default function () {
  const res = http.get(`${baseUrl}${auctionsPath}`, {
    headers: { Accept: 'application/json' },
    timeout: '10s',
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (!ok) errorCounter.add(1);
  sleep(0.5);
}
