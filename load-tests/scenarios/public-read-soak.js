import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const auctionsPath = __ENV.AUCTIONS_PATH || '/v1/auctions?limit=20&page=1&includeMeta=false&compact=true';
const healthPath = __ENV.HEALTH_PATH || '/health';

const errorCounter = new Counter('app_errors');

export const options = {
  scenarios: {
    soak_test: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{endpoint:auctions-list}': ['p(95)<1500'],
    app_errors: ['count<200'],
  },
};

export function setup() {
  const healthRes = http.get(`${baseUrl}${healthPath}`);
  check(healthRes, {
    'health endpoint is 2xx': (r) => r.status >= 200 && r.status < 300,
  });
}

function requestTagged(url, endpoint) {
  const res = http.get(url, {
    headers: { Accept: 'application/json' },
    timeout: '20s',
    tags: { endpoint },
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (!ok) errorCounter.add(1, { endpoint });
  return res;
}

export default function () {
  requestTagged(`${baseUrl}${auctionsPath}`, 'auctions-list');
  sleep(1);
}
