const { spawn } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const dotenv = require('dotenv');

const envFileArg = process.argv[2];
const command = process.argv[3];
const commandArgs = process.argv.slice(4);

if (!envFileArg || !command) {
  console.error('Usage: node scripts/run-with-env.js <env-file> <command> [args...]');
  process.exit(1);
}

const envFilePath = resolve(process.cwd(), envFileArg);
if (!existsSync(envFilePath)) {
  console.error(`Env file not found: ${envFilePath}`);
  process.exit(1);
}

const parsed = dotenv.parse(readFileSync(envFilePath));
const childEnv = {
  ...process.env,
  ...parsed,
  ENV_FILE: envFileArg,
};

const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: childEnv,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
