const fs = require('fs');
const path = require('path');

const summaryPath = path.resolve(process.argv[2] || './reports/k6-1k-summary.json');
const outCsv = path.resolve(process.argv[3] || './reports/k6-1k-summary.csv');
const outHtml = path.resolve(process.argv[4] || './reports/k6-1k-summary.html');

if (!fs.existsSync(summaryPath)) {
  console.error('Summary file not found:', summaryPath);
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const metrics = summary.metrics || summary;

function getMetric(metricName, keys = ['avg','p(90)','p(95)','p(99)','max','min']) {
  const m = metrics[metricName];
  if (!m || !m.values) return null;
  const vals = m.values;
  const out = {};
  keys.forEach(k => { if (vals[k] !== undefined) out[k] = vals[k]; });
  return out;
}

const httpDuration = getMetric('http_req_duration', ['avg','p(90)','p(95)','p(99)','max']);
const httpReqs = metrics['http_reqs'] ? metrics['http_reqs'].values : null;
const httpFailed = metrics['http_req_failed'] ? metrics['http_req_failed'].values : null;
const dataReceived = metrics['data_received'] ? metrics['data_received'].values : null;
const dataSent = metrics['data_sent'] ? metrics['data_sent'].values : null;

// CSV: key,value
let csvLines = [];
if (httpReqs) {
  csvLines.push(['http_reqs_total', httpReqs.count || ''].join(','));
  csvLines.push(['http_reqs_rate_per_s', httpReqs.rate || ''].join(','));
}
if (httpFailed) {
  csvLines.push(['http_req_failed_rate', httpFailed.rate || ''].join(','));
}
if (httpDuration) {
  Object.entries(httpDuration).forEach(([k,v]) => csvLines.push([`http_req_duration_${k.replace(/\(|\)/g,'')}`, v].join(',')));
}
if (dataReceived) csvLines.push(['data_received_bytes', dataReceived.count || ''].join(','));
if (dataSent) csvLines.push(['data_sent_bytes', dataSent.count || ''].join(','));

fs.writeFileSync(outCsv, csvLines.join('\n'));
console.log('Wrote CSV to', outCsv);

// Generate simple HTML with Chart.js for http_req_duration metrics
const labels = ['avg','p(90)','p(95)','p(99)','max'];
const values = labels.map(l => (httpDuration && httpDuration[l]) ? httpDuration[l] : 0);

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>k6 1k Summary</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <h1>k6 1k Summary Report</h1>
  <p>Source: ${summaryPath}</p>
  <canvas id="chart" width="800" height="400"></canvas>
  <h2>Key numbers</h2>
  <ul>
    <li>Total requests: ${httpReqs ? httpReqs.count : 'n/a'}</li>
    <li>Requests/sec: ${httpReqs ? httpReqs.rate : 'n/a'}</li>
    <li>Failed rate: ${httpFailed ? httpFailed.rate : 'n/a'}</li>
    <li>Data received (bytes): ${dataReceived ? dataReceived.count : 'n/a'}</li>
    <li>Data sent (bytes): ${dataSent ? dataSent.count : 'n/a'}</li>
  </ul>
  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'http_req_duration (ms)',
          data: ${JSON.stringify(values)},
          backgroundColor: 'rgba(54,162,235,0.5)'
        }]
      },
      options: { scales: { y: { beginAtZero: true } } }
    });
  </script>
</body>
</html>`;

fs.writeFileSync(outHtml, html);
console.log('Wrote HTML report to', outHtml);
