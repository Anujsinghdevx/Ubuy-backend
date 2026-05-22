#!/usr/bin/env node
/*
 * Simple demo runner for terminal recordings/GIFs.
 * - Shows health
 * - Lists a few auctions
 * - Polls active auctions a few times to simulate activity
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:6000 node ./scripts/demo-runner.js
 */

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:6000';
const fetch = global.fetch || require('node-fetch');

function now() {
  return new Date().toISOString();
}

async function getHealth() {
  try {
    const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
    const body = await res.text();
    console.log(`[${now()}] /health -> ${res.status}`);
    console.log(body.substring(0, 1000));
  } catch (err) {
    console.error('Health check failed', err.message || err);
  }
}

async function listAuctions(limit = 5) {
  try {
    const res = await fetch(`${baseUrl}/v1/auctions?limit=${limit}&page=1&compact=true`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = await res.json();
    console.log(`[${now()}] /v1/auctions -> ${res.status}  (items: ${Array.isArray(body?.data) ? body.data.length : 'unknown'})`);
    if (Array.isArray(body?.data)) {
      body.data.slice(0, limit).forEach((a, i) => {
        console.log(`  ${i + 1}. ${a.title || a._id} — ${a.currentPrice ?? a.startingPrice}`);
      });
    } else {
      console.log(JSON.stringify(body).slice(0, 400));
    }
  } catch (err) {
    console.error('List auctions failed', err.message || err);
  }
}

async function listActive(limit = 5) {
  try {
    const res = await fetch(`${baseUrl}/v1/auctions/active?limit=${limit}&page=1&compact=true`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = await res.json();
    console.log(`[${now()}] /v1/auctions/active -> ${res.status}  (items: ${Array.isArray(body?.data) ? body.data.length : 'unknown'})`);
  } catch (err) {
    console.error('List active auctions failed', err.message || err);
  }
}

async function main() {
  console.log('Demo runner — baseUrl=', baseUrl);
  await getHealth();
  await listAuctions(5);
  await listActive(5);

  console.log('\nPolling active auctions 6 times (1s interval) to simulate activity...');
  for (let i = 0; i < 6; i++) {
    await listActive(5);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\nDemo finished. Use this output to record a short terminal GIF or include in screencast.');
}

main().catch((e) => {
  console.error('Demo runner error', e);
  process.exit(1);
});
