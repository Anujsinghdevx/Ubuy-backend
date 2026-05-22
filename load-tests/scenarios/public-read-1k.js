import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const auctionsPath = __ENV.AUCTIONS_PATH || '/v1/auctions?limit=20&page=1&includeMeta=false&compact=true';
const activeAuctionsPath = __ENV.ACTIVE_AUCTIONS_PATH || '/v1/auctions/active?limit=20&page=1&includeMeta=false&compact=true';
const categoryAuctionsPath = __ENV.CATEGORY_AUCTIONS_PATH || '/v1/auctions/by-category?category=fashion&limit=20&page=1&includeMeta=false&compact=true';
const healthPath = __ENV.HEALTH_PATH || '/health';

const errorCounter = new Counter('app_errors');

export const options = {
  scenarios: {
    reach_1k_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '3m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.03'],
    'http_req_duration{endpoint:auctions-list}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{endpoint:auctions-active}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{endpoint:auctions-by-category}': ['p(95)<1000', 'p(99)<2000'],
    app_errors: ['count<100'],
  },
};

export function setup() {
  const healthRes = request(`${baseUrl}${healthPath}`);
  check(healthRes, {
    'health endpoint is 2xx': (r) => r.status >= 200 && r.status < 300,
  });
}

function request(url) {
  const res = http.get(url, {
    headers: {
      Accept: 'application/json',
    },
    timeout: '15s',
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (!ok) {
    errorCounter.add(1);
  }

  return res;
}

function requestTagged(url, endpoint) {
  const res = http.get(url, {
    headers: {
      Accept: 'application/json',
    },
    timeout: '15s',
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

export default function () {
  const roll = Math.random();

  if (roll < 0.6) {
    requestTagged(`${baseUrl}${auctionsPath}`, 'auctions-list');
  } else if (roll < 0.9) {
    requestTagged(`${baseUrl}${activeAuctionsPath}`, 'auctions-active');
  } else {
    requestTagged(`${baseUrl}${categoryAuctionsPath}`, 'auctions-by-category');
  }

  sleep(1);
}
