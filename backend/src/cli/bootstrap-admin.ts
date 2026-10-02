/*
 * Operator tool: create the first administrator (a user of the app, stored in the database).
 *   Interactive (asks for email, name and password):  bash create-admin.sh
 *   Scripted (password on stdin):
 *     printf '%s' "$PASSWORD" | pnpm --filter @boq/backend admin:bootstrap admin@example.com "Full Name"
 * The password is never taken as an argument, so it never appears in shell history or the process
 * list. Refused once any enabled user can manage users: later users are added in the app.
 */
/* eslint-disable no-console */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '@boq/shared';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { createUserAdminService } from '../services/user-admin';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = loadEnv().DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (backend/.env). Run installer.sh first.');
  process.exit(1);
}

const isEmail = (v: string) => z.string().email().safeParse(v).success;

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Read a line without echoing it (the password). */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve) => {
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          process.exit(130); // Ctrl-C
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function askUntil(question: string, valid: (v: string) => string | null): Promise<string> {
  for (;;) {
    const v = await ask(question);
    const problem = valid(v);
    if (!problem) return v;
    console.log(`  ${problem}`);
  }
}

async function askPassword(): Promise<string> {
  for (;;) {
    const p = await askHidden(`Password (${PASSWORD_MIN_LENGTH}+ characters): `);
    if (p.length < PASSWORD_MIN_LENGTH) {
      console.log(`  At least ${PASSWORD_MIN_LENGTH} characters, please.`);
      continue;
    }
    if ((await askHidden('Password again: ')) === p) return p;
    console.log('  The two passwords differ. Try again.');
  }
}

async function readStdin(): Promise<string> {
  let s = '';
  for await (const chunk of process.stdin) s += String(chunk);
  return s.replace(/\r?\n$/, '');
}

const pool = createPool(url, 2);
const service = createUserAdminService(pool);
try {
  let [email, name] = process.argv.slice(2);
  let password: string;
  if (email && name) {
    password = await readStdin();
  } else if (process.stdin.isTTY) {
    if (await service.hasAdministrator()) {
      throw new Error('An administrator already exists. Sign in and add users in the app.');
    }
    console.log('Create the first administrator of Almailem BoQ Manager.');
    email = await askUntil('Email: ', (v) => (isEmail(v) ? null : 'That is not an email address.'));
    name = await askUntil('Full name: ', (v) => (v ? null : 'A name is required.'));
    password = await askPassword();
  } else {
    throw new Error('Usage: admin:bootstrap <email> "<name>" with the password on stdin');
  }
  const user = await service.bootstrapAdmin({ email, name, password });
  console.log(
    `Created administrator ${user.email} with roles: ${user.roles.map((r) => r.name).join(', ')}`,
  );
} catch (err) {
  // Never print the input back; validation details name fields only.
  console.error(err instanceof Error ? err.message : 'Failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
