import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const auctionsPath = __ENV.AUCTIONS_PATH || '/v1/auctions?limit=20&page=1&includeMeta=false&compact=true';
const activeAuctionsPath = __ENV.ACTIVE_AUCTIONS_PATH || '/v1/auctions/active?limit=20&page=1&includeMeta=false&compact=true';
const healthPath = __ENV.HEALTH_PATH || '/health';

const errorCounter = new Counter('app_errors');

export const options = {
  scenarios: {
    local_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 150 },
        { duration: '2m', target: 250 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:auctions-list}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{endpoint:auctions-active}': ['p(95)<800', 'p(99)<1500'],
    app_errors: ['count<10'],
  },
};

export function setup() {
  const healthRes = request(`${baseUrl}${healthPath}`);
  check(healthRes, {
    'health endpoint is 2xx': (r) => r.status >= 200 && r.status < 300,
  });
}

function requestTagged(url, endpoint) {
  const res = http.get(url, {
    headers: {
      Accept: 'application/json',
    },
    timeout: '10s',
    tags: {
      endpoint,
    },
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (!ok) {
    errorCounter.add(1, { endpoint });
  }

  return res;
}

function request(url) {
  const res = http.get(url, {
    headers: {
      Accept: 'application/json',
    },
    timeout: '10s',
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (!ok) {
    errorCounter.add(1);
  }

  return res;
}

export default function () {
  const roll = Math.random();

  if (roll < 0.75) {
    requestTagged(`${baseUrl}${auctionsPath}`, 'auctions-list');
  } else {
    requestTagged(`${baseUrl}${activeAuctionsPath}`, 'auctions-active');
  }

  sleep(1);
}
