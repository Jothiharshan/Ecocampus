import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { createDefaultState } from '../public/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let pool;

function parseDsnOptions(raw) {
  const dsn = new URL(raw);
  if (!['mysql:', 'mysqls:'].includes(dsn.protocol)) {
    throw new Error('DATABASE_URL must use the MySQL protocol.');
  }

  const options = {
    host: decodeURIComponent(dsn.hostname.replace(/^\[|\]$/g, '')),
    port: Number(dsn.port) || 3306,
    user: decodeURIComponent(dsn.username),
    password: decodeURIComponent(dsn.password),
    database: decodeURIComponent(dsn.pathname.replace(/^\//, '')),
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 20,
    enableKeepAlive: true,
    charset: 'utf8mb4'
  };

  for (const [key, value] of dsn.searchParams) {
    if (['ssl', 'connectTimeout', 'charset', 'timezone', 'dateStrings'].includes(key)) {
      try { options[key] = JSON.parse(value); }
      catch { options[key] = value; }
    }
  }
  return options;
}

function getPool() {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not available to the server process.');
  pool = mysql.createPool(parseDsnOptions(raw));
  return pool;
}

async function runMigrations() {
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS ecocampus_schema_migrations (
    migration_id VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const migrationDir = path.join(here, 'migrations');
  const files = (await fs.readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const migrationId = filename.replace(/\.sql$/, '');
    const [rows] = await db.execute(
      'SELECT migration_id FROM ecocampus_schema_migrations WHERE migration_id = ?',
      [migrationId]
    );
    if (rows.length) continue;
    const sql = await fs.readFile(path.join(migrationDir, filename), 'utf8');
    await db.query(sql);
    await db.execute(
      'INSERT IGNORE INTO ecocampus_schema_migrations (migration_id) VALUES (?)',
      [migrationId]
    );
  }
}

function parseStateJson(value) {
  if (typeof value === 'string') return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'));
  return value;
}

export async function initializeDatabase() {
  const db = getPool();
  await runMigrations();
  const sample = JSON.stringify(createDefaultState());
  await db.execute(
    'INSERT IGNORE INTO ecocampus_app_state (state_id, state_json, version) VALUES (?, ?, 1)',
    ['main', sample]
  );
  await db.query('SELECT 1');
}

export async function readSharedState() {
  const [rows] = await getPool().execute(
    'SELECT state_json, version, updated_at FROM ecocampus_app_state WHERE state_id = ?',
    ['main']
  );
  if (!rows.length) throw new Error('The EcoCampus state row has not been initialized.');
  return {
    state: parseStateJson(rows[0].state_json),
    version: Number(rows[0].version),
    updatedAt: rows[0].updated_at
  };
}

async function writeVersionedState(nextState, expectedVersion) {
  const db = getPool();
  const [result] = await db.execute(
    'UPDATE ecocampus_app_state SET state_json = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE state_id = ? AND version = ?',
    [JSON.stringify(nextState), 'main', expectedVersion]
  );
  if (result.affectedRows !== 1) {
    return { conflict: true, current: await readSharedState() };
  }
  return { conflict: false, current: { state: nextState, version: Number(expectedVersion) + 1 } };
}

export async function saveSharedState(nextState, expectedVersion) {
  return writeVersionedState(nextState, expectedVersion);
}

export async function resetSharedState(expectedVersion) {
  return writeVersionedState(createDefaultState(), expectedVersion);
}

export async function pingDatabase() {
  await getPool().query('SELECT 1');
  return true;
}

export async function closeDatabase() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
