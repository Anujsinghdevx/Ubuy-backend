const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const scriptPath = process.argv[2];
const args = process.argv.slice(3);

if (!scriptPath) {
  console.error('Usage: node scripts/run-k6.js <script-path> [k6 args...]');
  process.exit(1);
}

const candidates = [
  process.env.K6_PATH,
  join(process.env.ProgramFiles || 'C:\\Program Files', 'k6', 'k6.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'k6', 'k6.exe'),
].filter(Boolean);

const k6Path = candidates.find((candidate) => existsSync(candidate));

if (!k6Path) {
  console.error('k6 executable not found. Set K6_PATH or install k6 in C:\\Program Files\\k6\\k6.exe');
  process.exit(1);
}

const child = spawn(k6Path, ['run', ...args, scriptPath], {
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
