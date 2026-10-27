import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeDatabase,
  initializeDatabase,
  pingDatabase,
  readSharedState,
  resetSharedState,
  saveSharedState
} from './server/database.js';
import { validateSharedState } from './server/state-validation.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = process.env.NODE_ENV === 'production' ? path.join(root, 'dist') : path.join(root, 'public');
const port = Number(process.env.PORT) || 3000;
const app = express();
let databaseReady = false;
let lastDatabaseErrorCode = '';
let databaseInitializationInProgress = false;
let databaseRetryTimer = null;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));

function scheduleDatabaseRecovery(delay = 1000) {
  if (databaseRetryTimer || databaseInitializationInProgress) return;
  databaseRetryTimer = setTimeout(() => {
    databaseRetryTimer = null;
    void initializeWithRetry();
  }, delay);
  databaseRetryTimer.unref();
}
function serviceUnavailable(res) {
  scheduleDatabaseRecovery();
  return res.status(503).json({ error: 'database_unavailable', message: 'The shared demo database is not ready. Please retry shortly.' });
}
function safeApiError(res, error) {
  const malformedJson = error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body');
  const status = error?.type === 'entity.too.large' ? 413 : malformedJson ? 400 : 500;
  if (status === 500) console.error('ECOCAMPUS_API_ERROR', String(error?.code || 'UNEXPECTED_ERROR').slice(0, 60));
  return res.status(status).json({
    error: status === 413 ? 'request_too_large' : status === 400 ? 'invalid_json' : 'request_failed',
    message: status === 413 ? 'Request is too large.' : status === 400 ? 'Request body must be valid JSON.' : 'The request could not be completed. Please retry.'
  });
}
function validVersion(value) { return Number.isSafeInteger(value) && value > 0; }

app.get('/api/health', async (_req, res) => {
  if (!databaseReady) return res.status(503).json({ ok: false, database: 'not-ready' });
  try {
    await pingDatabase();
    return res.status(200).json({ ok: true, database: 'ready' });
  } catch (error) {
    databaseReady = false;
    lastDatabaseErrorCode = String(error?.code || 'DATABASE_UNAVAILABLE').slice(0, 60);
    scheduleDatabaseRecovery();
    return res.status(503).json({ ok: false, database: 'not-ready' });
  }
});

app.get('/api/state', async (_req, res) => {
  if (!databaseReady) return serviceUnavailable(res);
  try { return res.json(await readSharedState()); }
  catch (error) {
    databaseReady = false;
    lastDatabaseErrorCode = String(error?.code || 'DATABASE_UNAVAILABLE').slice(0, 60);
    scheduleDatabaseRecovery();
    return serviceUnavailable(res);
  }
});

app.put('/api/state', async (req, res) => {
  if (!databaseReady) return serviceUnavailable(res);
  const { version, state } = req.body || {};
  if (!validVersion(version)) return res.status(400).json({ error: 'invalid_version', message: 'A valid state version is required.' });
  const validationError = validateSharedState(state);
  if (validationError) return res.status(400).json({ error: 'invalid_state', message: validationError });
  try {
    const result = await saveSharedState(state, version);
    if (result.conflict) return res.status(409).json({ error: 'state_conflict', current: result.current });
    return res.json({ version: result.current.version });
  } catch (error) {
    databaseReady = false;
    lastDatabaseErrorCode = String(error?.code || 'DATABASE_UNAVAILABLE').slice(0, 60);
    scheduleDatabaseRecovery();
    return safeApiError(res, error);
  }
});

app.post('/api/state/reset', async (req, res) => {
  if (!databaseReady) return serviceUnavailable(res);
  const { version } = req.body || {};
  if (!validVersion(version)) return res.status(400).json({ error: 'invalid_version', message: 'A valid state version is required.' });
  try {
    const result = await resetSharedState(version);
    if (result.conflict) return res.status(409).json({ error: 'state_conflict', current: result.current });
    return res.json(result.current);
  } catch (error) {
    databaseReady = false;
    lastDatabaseErrorCode = String(error?.code || 'DATABASE_UNAVAILABLE').slice(0, 60);
    scheduleDatabaseRecovery();
    return safeApiError(res, error);
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'API endpoint not found.' }));
app.use(express.static(staticRoot, { fallthrough: true, etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html') && !path.extname(req.path)) {
    return res.sendFile(path.join(staticRoot, 'index.html'), error => { if (error) next(error); });
  }
  return next();
});
app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
app.use((error, _req, res, _next) => safeApiError(res, error));

const server = app.listen(port, '0.0.0.0', () => {
  console.info(`EcoCampus server listening on port ${port}.`);
});

async function initializeWithRetry() {
  if (databaseInitializationInProgress) return;
  databaseInitializationInProgress = true;
  try {
    const delays = [0, 500, 1500, 4000, 10000];
    for (const delay of delays) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await initializeDatabase();
        databaseReady = true;
        lastDatabaseErrorCode = '';
        console.info('EcoCampus database schema and shared sample state are ready.');
        return;
      } catch (error) {
        databaseReady = false;
        lastDatabaseErrorCode = String(error?.code || 'DATABASE_SETUP_FAILED').slice(0, 60);
        console.error('ECOCAMPUS_DATABASE_SETUP_RETRY', lastDatabaseErrorCode);
      }
    }
    console.error('ECOCAMPUS_DATABASE_SETUP_NOT_READY', lastDatabaseErrorCode || 'UNKNOWN');
    scheduleDatabaseRecovery(30_000);
  } finally {
    databaseInitializationInProgress = false;
  }
}
void initializeWithRetry();

async function shutdown(signal) {
  console.info(`EcoCampus received ${signal}; closing server.`);
  server.close(async () => {
    try { await closeDatabase(); }
    catch { /* shutdown is best-effort */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
