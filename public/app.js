import {
  ALERT_THRESHOLD_KWH, HIGH_PRIORITY_THRESHOLD_KWH, SAMPLE_RATE_PER_KWH,
  createDefaultState, roomIsFlagged, getRoomAlerts, makeTrend, makeForecast,
  makeReportRows, calculateMST, calculateShortestPath, optimizeSensorPlacement
} from './data.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let state = createDefaultState();
let databaseReady = false;
let databasePhase = 'loading';
let databaseVersion = 0;
let databaseError = '';
let saveQueue = Promise.resolve();
let saveGeneration = 0;
let savesPending = 0;
const pages = {
  home: ['Home', 'CAMPUS ENERGY, IN VIEW'], dashboard: ['Dashboard', 'ENERGY OPTIMIZATION DASHBOARD'],
  layout: ['Campus Layout', 'CAMPUS LAYOUT MANAGER'], analytics: ['Analytics', 'ENERGY ANALYTICS'],
  control: ['Smart Control', 'SIMULATED DEVICE CONTROLS'], reports: ['Reports', 'ENERGY REPORTS'],
  business: ['Business Model', 'A PRACTICAL CAMPUS ENERGY MODEL'], rooms: ['Room Monitoring', 'ROOM-BY-ROOM READINGS'],
  alerts: ['Wastage Alerts', 'RULE-BASED DETECTION']
};
const typeColor = { Classroom: '#4fcb71', Laboratory: '#61b4df', Office: '#77cf7a', Library: '#9265d8', Auditorium: '#eda813', Hallway: '#86cda7', Studio: '#de86a9', 'Common area': '#92c98b' };
let currentPage = pages[window.location.hash.slice(1)] ? window.location.hash.slice(1) : 'home';
let roomFilter = 'all';
let roomSearch = '';
let alertFilter = 'all';
let graphMode = 'select';
let graphSelection = [];
let graphResult = { type: 'none', edges: [], nodes: [], path: [], distance: 0 };
let selectedRoomCode = state.rooms[0]?.code || '';
let reportRowsCache = [];
let toastTimer;
let analyticsRun = 0;
let analysisOutput = '';
let insightOutput = '';
let forecastUpdatedAt = '';
let persistTimer;

function setDatabaseStatus(phase, message) {
  databasePhase = phase;
  const badge = $('#db-status');
  if (badge) { badge.dataset.phase = phase; badge.textContent = message; }
  const retry = $('#db-retry');
  if (retry) {
    retry.hidden = phase !== 'error';
    retry.dataset.action = databaseReady ? 'retry-save' : 'retry-database';
    retry.textContent = databaseReady ? 'Retry save' : 'Retry connection';
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  let payload = {};
  try { payload = await response.json(); } catch (_) { /* API errors can have an empty body. */ }
  if (!response.ok) {
    const error = new Error(payload.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function renderDatabaseGate() {
  const target = $('#main-content');
  if (!target) return;
  if (databasePhase === 'loading') {
    target.innerHTML = `<section class="database-gate" role="status"><span class="gate-mark">♧</span><h1>Connecting to the shared demo database</h1><p>Loading the current simulated campus state before enabling edits.</p><div class="gate-progress" aria-hidden="true"></div></section>`;
  } else {
    target.innerHTML = `<section class="database-gate database-gate-error" role="alert"><span class="gate-mark">!</span><h1>Database connection unavailable</h1><p>${esc(databaseError || 'EcoCampus could not load shared state. No browser-only substitute was opened.')}</p><button class="button button-primary" type="button" data-action="retry-database">Retry connection</button><small>Your simulated data is not being changed while the database is offline.</small></section>`;
  }
}

async function loadSharedState() {
  databaseReady = false;
  databaseError = '';
  setDatabaseStatus('loading', 'Connecting to database…');
  render();
  const delays = [0, 500, 1000, 2000, 4000];
  let lastError;
  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index]) await new Promise(resolve => setTimeout(resolve, delays[index]));
    try {
      const result = await apiRequest('/api/state');
      if (!result.state || !Number.isSafeInteger(Number(result.version))) throw new Error('The database returned an invalid state response.');
      state = result.state;
      databaseVersion = Number(result.version);
      selectedRoomCode = state.rooms[0]?.code || '';
      databaseReady = true;
      setDatabaseStatus('ready', 'Shared demo · synced');
      render();
      return true;
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500 && error.status !== 503) break;
    }
  }
  databaseReady = false;
  databaseError = lastError?.status === 503 ? 'The server is waiting for MySQL to finish starting. Retry in a moment.' : 'Could not load the shared campus state. Check the connection and retry.';
  setDatabaseStatus('error', 'Database unavailable · Retry');
  render();
  return false;
}

function applyVersionConflict(error) {
  const current = error?.payload?.current;
  if (error?.status !== 409 || !current?.state || !Number.isSafeInteger(Number(current.version))) return false;
  saveGeneration += 1;
  savesPending = 0;
  state = current.state;
  databaseVersion = Number(current.version);
  selectedRoomCode = state.rooms[0]?.code || '';
  databaseReady = true;
  setDatabaseStatus('ready', 'Shared state refreshed');
  render();
  showToast('Another session saved first. The latest shared state is loaded; reapply your change if needed.', 'info');
  return true;
}

function persist(message = '', tone = 'success') {
  if (!databaseReady) {
    showToast('The database is not ready; this change was not saved.', 'info');
    return Promise.resolve(false);
  }
  const generation = saveGeneration;
  const snapshot = JSON.parse(JSON.stringify(state));
  savesPending += 1;
  setDatabaseStatus('saving', 'Saving shared demo…');
  const task = saveQueue.catch(() => undefined).then(async () => {
    if (generation !== saveGeneration) return false;
    const result = await apiRequest('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: databaseVersion, state: snapshot })
    });
    if (generation !== saveGeneration) return false;
    databaseVersion = Number(result.version);
    return true;
  });
  const finished = task.then(saved => {
    if (!saved || generation !== saveGeneration) return false;
    savesPending = Math.max(0, savesPending - 1);
    if (savesPending === 0) setDatabaseStatus('ready', 'Shared demo · synced');
    if (message) showToast(message, tone);
    return true;
  }).catch(async error => {
    if (generation !== saveGeneration) return false;
    savesPending = Math.max(0, savesPending - 1);
    if (applyVersionConflict(error)) return false;
    if (error.status === 400) {
      saveGeneration += 1;
      savesPending = 0;
      try {
        const latest = await apiRequest('/api/state');
        state = latest.state;
        databaseVersion = Number(latest.version);
        selectedRoomCode = state.rooms[0]?.code || '';
        setDatabaseStatus('ready', 'Invalid change · saved state restored');
        render();
        showToast(`The server rejected this change: ${error.message} The last saved state was restored.`, 'info');
      } catch (_) {
        databaseReady = false;
        databaseError = 'A change was rejected and the saved state could not be reloaded.';
        setDatabaseStatus('error', 'Database unavailable · Retry');
        render();
      }
      return false;
    }
    setDatabaseStatus('error', 'Save failed · Retry');
    showToast('Could not save to the shared database. Your change remains unsaved; use Retry.', 'info');
    return false;
  });
  saveQueue = finished.then(() => undefined);
  return finished;
}

async function resetSharedDemo() {
  if (!databaseReady) { showToast('The shared database is not connected; nothing was reset.', 'info'); return; }
  const confirmed = window.confirm('Reset the shared EcoCampus demo to its built-in sample rooms, pathways, device states, schedules, and settings? This changes the shared data for everyone using this project. No physical equipment is affected.');
  if (!confirmed) return;
  try {
    const result = await apiRequest('/api/state/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: databaseVersion })
    });
    saveGeneration += 1;
    savesPending = 0;
    state = result.state;
    databaseVersion = Number(result.version);
    selectedRoomCode = state.rooms[0]?.code || '';
    graphResult = { type: 'none', edges: [], nodes: [], path: [], distance: 0 };
    setDatabaseStatus('ready', 'Shared demo · synced');
    render();
    showToast('Shared demo state restored to the built-in sample dataset.');
  } catch (error) {
    if (!applyVersionConflict(error)) {
      setDatabaseStatus('error', 'Reset failed · Retry');
      const retry = $('#db-retry');
      if (retry) { retry.dataset.action = 'reset-demo'; retry.textContent = 'Retry reset'; }
      showToast('The shared demo could not be reset. The current database state was not replaced.', 'info');
    }
  }
}
function currency(amount, decimals = 0) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount); }
function totalRoomKwh() { return state.rooms.reduce((sum, room) => sum + Number(room.usageKwh || 0), 0); }
function flaggedRooms() { return getRoomAlerts(state.rooms, Number(state.params.threshold)).map(item => item.room); }
function showToast(message, tone = 'success') {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast toast-${tone}" role="status"><span class="toast-mark">${tone === 'success' ? '✓' : 'i'}</span>${esc(message)}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { root.innerHTML = ''; }, 3200);
}
function pageHeading(title, subtitle, eyebrow = '', actions = '') {
  return `<div class="page-heading flex items-end justify-between gap-5"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function demoNotice(text = 'All figures and statuses on this page are simulated examples. No physical sensors or devices are connected.') {
  return `<div class="demo-notice"><span class="demo-notice-icon">i</span><span><strong>DEMO ENVIRONMENT</strong> ${text}</span><span class="demo-tag">NOT LIVE</span></div>`;
}
function metricCard(icon, value, label, note, tone = 'green') {
  return `<article class="metric-card metric-${tone}"><div class="metric-icon">${icon}</div><div class="metric-value">${value}</div><div class="metric-label">${label}</div><div class="metric-note">${note}</div></article>`;
}
function panelTitle(title, subtitle = '', action = '') {
  return `<div class="panel-heading"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${action}</div>`;
}
function rangeButtons(group, selected, values) {
  return `<div class="segmented" role="group" aria-label="Select time range">${values.map(value => `<button type="button" class="segment ${value === selected ? 'selected' : ''}" data-range-group="${group}" data-range="${value}" aria-pressed="${value === selected}">${value}</button>`).join('')}</div>`;
}
function getAlerts() { return getRoomAlerts(state.rooms, Number(state.params.threshold)); }
function alertsPreview(limit = 3) {
  const alerts = getAlerts().slice(0, limit);
  if (!alerts.length) return `<div class="empty-inline"><span>✓</span><div><strong>No rooms currently meet the rule</strong><small>Current readings are below the combined occupancy, timetable, and energy conditions.</small></div></div>`;
  return alerts.map(({ room, severity, reason }) => `<article class="recommendation-card"><span class="severity-dot ${severity.toLowerCase()}"></span><div><strong>${esc(room.name)}</strong><p>${esc(reason)} ${esc('Recommended: check lights and HVAC.')}</p><small>${severity} priority · simulated reading</small></div><span class="rec-kwh">${Number(room.usageKwh).toFixed(1)}<small>kWh</small></span></article>`).join('');
}
function chartPaths(values, target, width = 760, height = 245) {
  if (!values.length) return { actual: '', target: '', area: '', points: [] };
  const max = Math.max(1, ...values, ...target) * 1.16;
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((v, i) => [i * step, height - 24 - (Number(v) / max) * (height - 52)]);
  const targetPoints = target.map((v, i) => [i * step, height - 24 - (Number(v) / max) * (height - 52)]);
  const line = list => list.map(([x,y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const actualPath = line(points);
  const targetPath = line(targetPoints);
  const area = `${actualPath} L${points.at(-1)[0].toFixed(1)},${height - 20} L0,${height - 20} Z`;
  return { actual: actualPath, target: targetPath, area, points };
}
function energyChart(range, compact = false) {
  const data = makeTrend(range);
  const width = 760, height = compact ? 220 : 250;
  const paths = chartPaths(data.actual, data.target, width, height);
  const max = Math.max(...data.actual, ...data.target) * 1.16;
  const ticks = [0, .25, .5, .75, 1].map(f => Math.round(max * f));
  const labelIdx = new Set(data.labels.map((_, i) => i).filter(i => i % Math.max(1, Math.ceil(data.labels.length / 7)) === 0 || i === data.labels.length - 1));
  const labels = [...labelIdx].map(i => `<text x="${paths.points[i]?.[0] ?? 0}" y="${height - 1}" text-anchor="middle">${esc(data.labels[i])}</text>`).join('');
  const dots = paths.points.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="3" class="chart-point"/>`).join('');
  return `<div class="chart-box ${compact ? 'compact-chart' : ''}"><div class="chart-y-labels">${ticks.reverse().map(v => `<span>${v.toLocaleString()}</span>`).join('')}</div><svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Simulated actual and optimized target energy use for ${range}"><defs><linearGradient id="energyFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#58c77b" stop-opacity=".22"/><stop offset="1" stop-color="#58c77b" stop-opacity="0"/></linearGradient></defs>${ticks.map((_,i) => `<line x1="0" y1="${22 + i*((height-46)/4)}" x2="${width}" y2="${22 + i*((height-46)/4)}" class="chart-gridline"/>`).join('')}<path d="${paths.area}" class="chart-area-fill"/><path d="${paths.target}" class="chart-target-line"/><path d="${paths.actual}" class="chart-actual-line"/>${dots}<g class="chart-x-labels">${labels}</g></svg></div><div class="chart-legend"><span><i class="legend-line actual"></i>Simulated actual consumption</span><span><i class="legend-line target"></i>Illustrative optimized target</span></div>`;
}
function dashboardHeatmap() {
  const rooms = ['A','B','C','D','E','F','G','H'];
  const cells = [];
  for (let r = 1; r <= 4; r++) for (let c = 0; c < rooms.length; c++) {
    const v = ((r * 17 + (c + 2) * 23 + c * r * 7) % 100) / 100;
    const level = v > .82 ? 'very-high' : v > .58 ? 'high' : v > .31 ? 'medium' : 'low';
    cells.push(`<button class="heat-cell ${level}" type="button" title="${rooms[c]}${r}: simulated occupancy probability ${(v*100).toFixed(0)}%" data-heat-room="${rooms[c]}${r}"><span>${rooms[c]}${r}</span><small>${Math.round(v*100)}%</small></button>`);
  }
  return `<div class="heatmap-grid">${cells.join('')}</div><div class="heat-legend"><span><i class="heat-swatch low"></i>Low &lt;30%</span><span><i class="heat-swatch medium"></i>Medium 30–59%</span><span><i class="heat-swatch high"></i>High 60–89%</span><span><i class="heat-swatch very-high"></i>Very high ≥90%</span></div>`;
}
function dashboardDevices(limit = 8) {
  return state.devices.slice(0, limit).map(device => `<article class="dash-device"><div class="device-status status-${device.status}"></div><div class="dash-device-head"><strong>${esc(device.type)}</strong><span>${esc(device.room)}</span></div><div class="dash-device-location">${esc(device.location)}</div><div class="dash-device-power">${device.powerW} <small>W</small></div><div class="dash-device-actions"><button type="button" class="device-toggle ${device.on ? 'on' : ''}" data-device-toggle="${esc(device.id)}" data-device-state="on" ${device.status === 'offline' ? 'disabled' : ''}>On</button><button type="button" class="device-toggle ${!device.on ? 'off-active' : ''}" data-device-toggle="${esc(device.id)}" data-device-state="off" ${device.status === 'offline' ? 'disabled' : ''}>Off</button></div></article>`).join('');
}
function roomTable(rows, includeActions = true) {
  if (!rows.length) return `<div class="empty-state"><strong>No rooms in this view</strong><span>Try a different filter or add a simulated room reading.</span></div>`;
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Room</th><th>Building</th><th>Energy · last hour</th><th>Occupancy</th><th>Timetable</th><th>Possible waste</th>${includeActions ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(room => `<tr><td><div class="room-cell"><span class="room-avatar" style="--room-color:${typeColor[room.type]||'#78c98a'}">${esc(room.code)}</span><span><strong>${esc(room.name)}</strong><small>${esc(room.type)} · capacity ${room.capacity}</small></span></div></td><td>${esc(room.building)}</td><td><strong>${Number(room.usageKwh).toFixed(1)} kWh</strong><small class="cell-demo">Simulated</small></td><td><span class="status-pill ${room.occupied ? 'occupied' : 'vacant'}">${room.occupied ? 'Occupied' : 'Vacant'}</span></td><td><span class="status-pill ${room.scheduled ? 'scheduled' : 'unscheduled'}">${room.scheduled ? 'Scheduled' : 'No class'}</span></td><td><span class="status-pill ${roomIsFlagged(room, Number(state.params.threshold)) ? 'possible-waste' : 'clear'}">${roomIsFlagged(room, Number(state.params.threshold)) ? 'Possible waste' : 'No flag'}</span></td>${includeActions ? `<td><button class="table-action" type="button" data-edit-room="${esc(room.id)}">Update</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function homeView() {
  const sum = totalRoomKwh();
  const currentCost = currency(sum * SAMPLE_RATE_PER_KWH);
  const actions = `<button class="button button-light inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-page="dashboard">Launch dashboard <span>→</span></button><button class="button button-outline-light inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-page="layout">Explore campus map</button>`;
  return `<section class="home-hero"><div class="hero-copy"><span class="hero-kicker"><span class="hero-kicker-dot"></span>SMART CAMPUS ENERGY · SIMULATED PROTOTYPE</span><h1>Optimize campus energy.<br/><em>One room at a time.</em></h1><p>Bring room readings, occupancy, and timetables into one clear view. Spot possible waste with explainable rules—not black-box AI.</p><div class="hero-actions">${actions}</div><div class="hero-caption"><span class="hero-check">✓</span>Sample data included <span class="hero-divider">·</span> No hardware required</div></div><div class="hero-visual" aria-label="Illustrative campus energy summary"><div class="hero-visual-orbit orbit-one"></div><div class="hero-visual-orbit orbit-two"></div><div class="hero-building"><div class="building-roof"></div><div class="building-front"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="building-base"></div></div><div class="floating-chip chip-energy"><span class="floating-icon">ϟ</span><span><small>Campus energy · sample</small><strong>1,247 <small>kWh</small></strong></span></div><div class="floating-chip chip-savings"><span class="floating-icon">↘</span><span><small>Illustrative saving</small><strong>$186 <small>/ day</small></strong></span></div><div class="hero-leaf leaf-one"></div><div class="hero-leaf leaf-two"></div><div class="hero-grid"></div></div></section>
    <section class="home-metrics grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Illustrative sample metrics">${metricCard('ϟ','1,247 kWh','Current energy consumption','Demo scenario · sample period')}${metricCard('$','$186','Today’s estimated savings','Example only · not a bill reduction','blue')}${metricCard('▦','342','Device optimizations','Illustrative campus-wide count','violet')}${metricCard('♧','2.0 t','CO₂ reduction this month','Scenario equivalent · simulated','mint')}</section>
    ${demoNotice('The reference-style metrics below are illustrative demo values. Room readings and controls share the project database; none represent live campus results.')}
    <section class="benefits-section"><div class="section-title"><span>WHY ECOCAMPUS</span><h2>Good decisions start with clear signals.</h2><p>A practical prototype for teams who want to make energy use easier to see, discuss, and improve.</p></div><div class="benefit-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"><article class="benefit-card"><span class="benefit-icon icon-money">$</span><h3>Cost awareness</h3><p>Bring estimated consumption and savings into the same conversation. Any rates and savings here are demo assumptions.</p></article><article class="benefit-card"><span class="benefit-icon icon-earth">◎</span><h3>Environmental context</h3><p>Show an illustrative emissions equivalent alongside energy readings for sustainability discussions.</p></article><article class="benefit-card"><span class="benefit-icon icon-chart">◒</span><h3>Data-driven insight</h3><p>Compare room readings with occupancy and scheduled use, then inspect why a rule raised a flag.</p></article><article class="benefit-card"><span class="benefit-icon icon-leaf">↗</span><h3>Practical follow-through</h3><p>Review a possible issue, examine the room context, and record a suggested next step.</p></article></div></section>
    <section class="math-strip"><div><span class="eyebrow">HOW IT WORKS</span><h2>Simple inputs. Explainable outputs.</h2><p>Energy reading + occupancy + timetable → transparent rule check → possible-waste signal → human review.</p></div><div class="math-cards"><span><b>Σ</b> Room totals</span><span><b>G</b> Campus pathways</span><span><b>P</b> Sample probability</span><span><b>ƒ</b> Rule-based analysis</span></div></section>`;
}

function dashboardView() {
  const range = state.dashboardRange || 'Today';
  const alerts = getAlerts();
  const rangeLabel = range === 'Today' ? 'today' : `this ${range.toLowerCase()}`;
  const actions = `<button class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="export-csv">⇩ Export CSV</button><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-open-room-form>＋ Add room</button>`;
  return `${pageHeading('Energy Optimization Dashboard','A single view of room readings, possible waste, and illustrative campus energy signals.','CAMPUS ENERGY OVERVIEW',actions)}${demoNotice('Dashboard charts and occupancy probabilities are synthesized examples. The current rule still requires high room use, vacancy, and no scheduled class.')}
    <div class="dashboard-toolbar"><div class="toolbar-label"><span class="status-live-dot"></span><strong>Sample energy activity</strong><small>simulated · not a live feed</small></div>${rangeButtons('dashboard',range,['Today','Week','Month','Year'])}</div>
    <section class="dashboard-main-grid grid grid-cols-1 gap-3 lg:grid-cols-[1.68fr_.82fr]"><article class="panel energy-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle(`Energy Consumption (${range}) · Σ f(r,t)`,'Simulated consumption compared with an illustrative efficiency target.')}${energyChart(range)}</article><aside class="panel recommendations-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Alerts & recommendations','Signals for a person to verify.',`<button class="text-link" data-page="alerts">All alerts →</button>`)}<div class="recommendation-list">${alertsPreview(4)}</div><div class="rule-reminder"><b>Rule:</b> &gt;${Number(state.params.threshold).toFixed(1)} kWh + vacant + unscheduled</div></aside></section>
    <section class="savings-grid grid grid-cols-2 gap-3 md:grid-cols-4">${metricCard('↘','$186','Today’s savings','Illustrative demo scenario')}${metricCard('▤','$4,250','Monthly savings','Sample estimate · not billing data','blue')}${metricCard('ϟ','1,247 kWh','Energy saved','Example period · simulated','violet')}${metricCard('♧','2.4 t','CO₂ reduction','Illustrative estimate','mint')}</section>
    <section class="dashboard-main-grid grid grid-cols-1 gap-3 lg:grid-cols-[1.68fr_.82fr]"><article class="panel heatmap-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Campus occupancy heat map','Synthetic occupancy probability by sample room.',`<span class="demo-tag">SIMULATED P(r,t)</span>`)}${dashboardHeatmap()}</article><article class="panel room-summary-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Rooms to review','Current room readings and detection context.',`<button class="text-link" data-page="rooms">View rooms →</button>`)}<div class="compact-room-list">${state.rooms.slice(0,5).map(room => `<div class="compact-room-row"><span class="room-avatar" style="--room-color:${typeColor[room.type]||'#78c98a'}">${esc(room.code)}</span><span><strong>${esc(room.name)}</strong><small>${room.occupied?'Occupied':'Vacant'} · ${room.scheduled?'Scheduled':'No class'}</small></span><b>${Number(room.usageKwh).toFixed(1)}<small>kWh</small></b></div>`).join('')}</div></article></section>
    <section class="panel devices-preview-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Device status grid','Illustrative profiles · buttons affect this demo only.',`<button class="text-link" data-page="control">Manage controls →</button>`)}<div class="device-grid dashboard-device-grid">${dashboardDevices(8)}</div><p class="panel-footnote">No physical devices are connected. Shared On/Off selections are demonstration states only.</p></section>`;
}

function roomsView() {
  const query = roomSearch.toLowerCase().trim();
  const rows = state.rooms.filter(room => (!query || `${room.name} ${room.building} ${room.type}`.toLowerCase().includes(query)) && (roomFilter === 'all' || (roomFilter === 'flagged' && roomIsFlagged(room, Number(state.params.threshold))) || (roomFilter === 'vacant' && !room.occupied) || (roomFilter === 'occupied' && room.occupied))).sort((a,b) => Number(b.usageKwh)-Number(a.usageKwh));
  return `${pageHeading('Room Monitoring','Compare room energy readings with the occupancy and timetable context.','ROOM-BY-ROOM READINGS',`<button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-open-room-form>＋ Add room reading</button>`)}${demoNotice('These rolling-hour readings are simulated and saved in the shared EcoCampus demo database.')}
    <section class="panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('All monitored rooms',`${state.rooms.length} sample rooms · ${fmtKwh(totalRoomKwh())} combined for the latest hour.`)}<div class="room-tools"><label class="search-control"><span>⌕</span><input id="room-search" type="search" value="${esc(roomSearch)}" placeholder="Search rooms or buildings" aria-label="Search rooms"/></label><div class="filter-chips">${[['all','All rooms'],['flagged','Possible waste'],['vacant','Vacant'],['occupied','Occupied']].map(([v,l]) => `<button type="button" class="filter-chip ${roomFilter===v?'active':''}" data-room-filter="${v}">${l}</button>`).join('')}</div></div><div id="room-table-wrap">${roomTable(rows)}</div><p class="panel-footnote">Detection is rule-based; a high reading alone is not enough to flag a room.</p></section>`;
}
function alertsView() {
  const alerts = getAlerts().filter(a => alertFilter === 'all' || (alertFilter === 'open' && !state.reviewed.includes(a.room.id)) || (alertFilter === 'reviewed' && state.reviewed.includes(a.room.id)));
  return `${pageHeading('Possible Energy Waste','Review each rule signal and verify conditions with the campus team.','WASTAGE ALERTS',`<button class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-page="rooms">Room readings</button>`)}${demoNotice('An alert indicates a possible issue to check. It is not proof of waste or a verified incident.')}
    <div class="rule-card"><span class="rule-symbol">ƒ</span><div><strong>Transparent detection rule</strong><p>Flag only when <code>energy &gt; ${Number(state.params.threshold).toFixed(1)} kWh in the last 60 min</code> <b>AND</b> <code>unoccupied</code> <b>AND</b> <code>not scheduled</code>. High priority: ≥${HIGH_PRIORITY_THRESHOLD_KWH.toFixed(1)} kWh; medium priority: above threshold but below ${HIGH_PRIORITY_THRESHOLD_KWH.toFixed(1)} kWh.</p></div></div>
    <section class="panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle(`${getAlerts().length} current possible-waste signals`,`${state.rooms.length} simulated rooms checked.`)}<div class="filter-chips alert-filters">${[['all','All flags'],['open','Needs review'],['reviewed','Reviewed']].map(([v,l]) => `<button class="filter-chip ${alertFilter===v?'active':''}" data-alert-filter="${v}" type="button">${l}</button>`).join('')}</div><div class="alert-list-large">${alerts.map(({room,severity,reason,recommendation}) => `<article class="alert-large-card"><div class="alert-symbol ${severity.toLowerCase()}">!</div><div class="alert-large-copy"><div class="alert-large-title"><strong>${esc(room.name)}</strong><span class="priority-badge ${severity.toLowerCase()}">${severity} priority</span>${state.reviewed.includes(room.id)?'<span class="reviewed-badge">Reviewed</span>':''}</div><p>${esc(reason)} This is a simulated reading.</p><div class="alert-recommendation"><b>Suggested action:</b> ${esc(recommendation)}</div></div><div class="alert-large-actions"><strong>${Number(room.usageKwh).toFixed(1)} <small>kWh</small></strong><button class="table-action" data-edit-room="${esc(room.id)}">Update room</button>${!state.reviewed.includes(room.id)?`<button class="table-action" data-review-room="${esc(room.id)}">Mark reviewed</button>`:''}</div></article>`).join('') || `<div class="empty-state"><strong>${getAlerts().length?'No alerts in this filter':'No rooms currently meet the rule'}</strong><span>${getAlerts().length?'Choose a different review filter.':`A room must exceed ${Number(state.params.threshold).toFixed(1)} kWh and be both vacant and unscheduled.`}</span></div>`}</div></section>`;
}
function fmtKwh(v) { return `${Number(v).toFixed(1)} kWh`; }

function roomForm(room = null, mode = 'reading') {
  const graphModeForm = mode === 'layout';
  const title = room ? 'Update room' : graphModeForm ? 'Add campus room' : 'Add room reading';
  return `<div class="modal-backdrop" data-close-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="room-modal-title"><header class="modal-header"><div><h2 id="room-modal-title">${title}</h2><p>Saved to the shared EcoCampus demo database.</p></div><button class="close-button" type="button" data-close-modal aria-label="Close">×</button></header><form class="modal-form" id="room-form" data-room-id="${room?esc(room.id):''}" data-room-mode="${graphModeForm?'layout':'reading'}"><div class="form-field"><label for="room-name">Room name</label><input id="room-name" name="name" required maxlength="70" placeholder="e.g. Lecture Hall 04" value="${room?esc(room.name):''}"/></div><div class="form-row"><div class="form-field"><label for="room-building">Building</label><input id="room-building" name="building" required maxlength="90" value="${room?esc(room.building):''}" placeholder="Academic Block A"/></div><div class="form-field"><label for="room-type">Room type</label><select id="room-type" name="type"><option ${room?.type==='Classroom'?'selected':''}>Classroom</option><option ${room?.type==='Laboratory'?'selected':''}>Laboratory</option><option ${room?.type==='Office'?'selected':''}>Office</option><option ${room?.type==='Library'?'selected':''}>Library</option><option ${room?.type==='Auditorium'?'selected':''}>Auditorium</option><option ${room?.type==='Hallway'?'selected':''}>Hallway</option><option ${room?.type==='Studio'?'selected':''}>Studio</option><option ${room?.type==='Common area'?'selected':''}>Common area</option></select></div></div><div class="form-row"><div class="form-field"><label for="room-capacity">Capacity</label><input id="room-capacity" name="capacity" type="number" min="1" max="5000" value="${room?room.capacity:30}" required/></div><div class="form-field"><label for="room-energy">Energy · last 60 min (kWh)</label><input id="room-energy" name="usageKwh" type="number" min="0" max="100000" step="0.1" value="${room?Number(room.usageKwh).toFixed(1):'0.5'}" required/></div></div><div class="form-row"><div class="form-field"><label for="room-occupancy">Occupancy</label><select id="room-occupancy" name="occupied"><option value="false" ${room&&!room.occupied?'selected':''}>Vacant</option><option value="true" ${room?.occupied?'selected':''}>Occupied</option></select></div><div class="form-field"><label for="room-schedule">Timetable</label><select id="room-schedule" name="scheduled"><option value="false" ${room&&!room.scheduled?'selected':''}>No class scheduled</option><option value="true" ${room?.scheduled?'selected':''}>Class scheduled</option></select></div></div><p class="form-help">This shared sample record is not a real sensor reading or physical device.</p><div class="modal-actions"><button type="button" class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-close-modal>Cancel</button><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" type="submit">${room?'Save room':'Add room'}</button></div></form></section></div>`;
}

function layoutView() {
  const selected = state.rooms.find(room => room.code === selectedRoomCode) || state.rooms[0];
  const roomFormCard = `<form class="layout-add-form" id="quick-room-form"><label>Room Name<input name="name" required maxlength="70" placeholder="e.g., Science Lab B201"/></label><label>Room Type<select name="type"><option>Classroom</option><option>Laboratory</option><option>Office</option><option>Library</option><option>Auditorium</option><option>Hallway</option></select></label><label>Capacity<input name="capacity" type="number" min="1" max="5000" value="30" required/></label><button class="button button-primary full-width inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" type="submit">＋ Add Room</button></form>`;
  const graphTools = `<div class="graph-toolbar"><div class="graph-control-row"><span class="toolbar-section-label">Interaction mode</span>${[['select','↖ Select'],['room','＋ Add room'],['pathway','⌁ Add pathway']].map(([m,l]) => `<button class="mode-button ${graphMode===m?'active':''}" data-graph-mode="${m}" type="button">${l}</button>`).join('')}</div><div class="graph-control-row"><span class="toolbar-section-label">Analysis tools</span><button class="mode-button" data-graph-analysis="mst">♧ Minimum spanning tree</button><button class="mode-button" data-graph-analysis="sensors">⌁ Sensor placement</button><label class="path-select-label">From<select id="path-from">${state.rooms.map(r=>`<option value="${esc(r.code)}" ${r.code===state.rooms[0]?.code?'selected':''}>${esc(r.code)}</option>`).join('')}</select></label><label class="path-select-label">To<select id="path-to">${state.rooms.map(r=>`<option value="${esc(r.code)}" ${r.code===state.rooms.at(-1)?.code?'selected':''}>${esc(r.code)}</option>`).join('')}</select></label><button class="mode-button" data-graph-analysis="shortest">↗ Shortest path</button><button class="mode-button subtle" data-graph-clear>Clear</button></div>${graphMode==='pathway'?`<div class="pathway-distance"><label>Pathway length (m)<input id="path-distance" type="number" min="1" max="100000" step="0.1" value="60"/></label><span>Click two room nodes to connect them.</span></div>`:''}</div>`;
  return `${pageHeading('Campus Layout Manager','Model rooms and pathways, then explore graph algorithms on the sample campus.','GRAPH-BASED CAMPUS PLANNING',`<span class="simulation-state">SIMULATED GRAPH</span>`)}${demoNotice('The map, pathways, and suggested sensor locations are simulated planning data. They do not represent installed infrastructure.')}
    <div class="layout-workspace"><aside class="panel room-management-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm"><div class="section-head-icon"><span>▦</span><div><h2>Room Management</h2><p>Vertices V · ${state.rooms.length} rooms</p></div></div>${roomFormCard}<div class="list-heading"><h3>Rooms List</h3><small>${state.rooms.length} total</small></div><div class="layout-room-list">${state.rooms.map(room=>`<article class="layout-room-card ${room.code===selectedRoomCode?'selected':''}" data-select-room="${esc(room.code)}"><span class="room-avatar" style="--room-color:${typeColor[room.type]||'#78c98a'}">${esc(room.code)}</span><div><strong>${esc(room.name)}</strong><small>${esc(room.type)} · capacity ${room.capacity}</small></div><button type="button" class="icon-button danger-icon" data-delete-room="${esc(room.id)}" aria-label="Delete ${esc(room.name)}">×</button></article>`).join('')}</div></aside>
    <section class="panel graph-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Campus Graph Visualization','Rooms are vertices; walkways are weighted edges.')} ${graphTools}<div class="graph-canvas">${campusGraph()}<div class="graph-legend"><strong>Campus legend</strong><span><i style="--legend:#55c778"></i>Classroom</span><span><i style="--legend:#61b4df"></i>Laboratory</span><span><i style="--legend:#7acb7e"></i>Office</span><span><i style="--legend:#9265d8"></i>Library</span><span><i style="--legend:#eda813"></i>Auditorium</span><hr/><span><i class="line-legend mst"></i>MST (wiring)</span><span><i class="line-legend sensor"></i>Sensor coverage</span><span><i class="line-legend path"></i>Shortest path</span></div></div><div class="graph-status"><span>▦ Rooms: <b>${state.rooms.length}</b></span><span>▧ Pathways: <b>${state.pathways.length}</b></span><span>ϟ Active analysis: <b>${graphResult.type==='none'?'None':esc(graphResult.type)}</b></span><span>↖ Mode: <b>${esc(graphMode)}</b></span></div></section>
    <aside class="layout-analysis-column"><article class="analysis-tool-card"><span class="analysis-icon green">♧</span><h3>Minimum Spanning Tree</h3><p>Find the shortest total pathway network connecting the campus rooms with Kruskal’s algorithm.</p><button class="button button-primary full-width inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-graph-analysis="mst">Calculate MST</button><div class="analysis-result">${graphResult.type==='mst'?`<strong>${graphResult.edges.length} pathways · ${graphResult.distance} m</strong><small>${graphResult.connected?'All room nodes connected.':'Disconnected sections remain; add a pathway.'}</small>`:'Ready to calculate on the sample graph.'}</div></article><article class="analysis-tool-card"><span class="analysis-icon mint">⌁</span><h3>Sensor Placement</h3><p>Greedy coverage suggestion: select room locations whose nodes cover the graph. No sensors are installed.</p><button class="button button-primary full-width inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-graph-analysis="sensors">Optimize Sensors</button><div class="analysis-result">${graphResult.type==='sensors'?`<strong>${graphResult.nodes.length} sample locations</strong><small>${graphResult.nodes.map(esc).join(' · ')}</small>`:'Click to calculate an illustrative room coverage set.'}</div></article><article class="analysis-tool-card selected-room-card"><span class="analysis-icon blue">⌖</span><h3>Selected room</h3>${selected?`<strong>${esc(selected.name)}</strong><p>${esc(selected.type)} · ${selected.capacity} capacity · ${esc(selected.building)}</p>`:'<p>Select a room node in the graph.</p>'}<p class="analysis-hint">Select two rooms above and use Shortest path to compare weighted routes.</p>${graphResult.type==='shortest'?`<div class="analysis-result"><strong>${graphResult.path.map(esc).join(' → ')}</strong><small>Total route: ${graphResult.distance} m</small></div>`:''}</article></aside></div>`;
}
function campusGraph() {
  const pos = new Map(state.rooms.map((room,i)=>[room.code,{ x:Math.max(55,Math.min(665,Number(room.graphX)||130+(i%3)*190)), y:Math.max(55,Math.min(570,Number(room.graphY)||100+(i%4)*120)) }]));
  const mstIds = new Set(graphResult.type==='mst'?graphResult.edges.map(e=>e.id):[]);
  const pathPairs = new Set(graphResult.type==='shortest'?graphResult.path.slice(1).map((code,i)=>[graphResult.path[i],code].sort().join('|')):[]);
  const coverSet = graphResult.type==='sensors'?new Set(graphResult.nodes):new Set();
  const edgeEls = state.pathways.map(edge=>{const a=pos.get(edge.from),b=pos.get(edge.to);if(!a||!b)return '';const pair=[edge.from,edge.to].sort().join('|');const lineClass=pathPairs.has(pair)?'graph-edge shortest':mstIds.has(edge.id)?'graph-edge mst':graphResult.type==='sensors'&&coverSet.has(edge.from)&&coverSet.has(edge.to)?'graph-edge sensor':'graph-edge';return `<g><line class="${lineClass}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><rect class="edge-label-bg" x="${(a.x+b.x)/2-17}" y="${(a.y+b.y)/2-11}" width="34" height="18" rx="7"/><text class="edge-label" x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2+2}" text-anchor="middle">${Number(edge.distance)}m</text></g>`}).join('');
  const nodeEls=state.rooms.map(room=>{const p=pos.get(room.code);const fill=typeColor[room.type]||'#80c98e';const selected=room.code===selectedRoomCode?' selected-node':'';const sensor=coverSet.has(room.code)?'<circle class="sensor-ring" r="28"/>':'';return `<g class="campus-node${selected}" data-node-code="${esc(room.code)}" tabindex="0" role="button" aria-label="Select ${esc(room.name)}"><circle class="node-shadow" r="21"/><circle class="node-circle" r="19" fill="${fill}"/><text class="node-code" text-anchor="middle" y="4">${esc(room.code)}</text>${sensor}<title>${esc(room.name)} · ${esc(room.type)}</title></g>`.replace('<g class="campus-node','<g transform="translate('+p.x+' '+p.y+')" class="campus-node')}).join('');
  return `<svg class="campus-graph-svg" viewBox="0 0 720 630" role="img" aria-label="Interactive campus room and pathway graph"><g class="graph-edges">${edgeEls}</g><g class="graph-nodes">${nodeEls}</g></svg>`;
}

function analyticsView() {
  const trend = state.analyticsRange || 'Week';
  const forecast = makeForecast(state.params);
  const buildingTotals = [...new Set(state.rooms.map(room=>room.building))].slice(0,5).map((building,i)=>({building,savings:Math.round(520+(state.rooms.filter(r=>r.building===building).reduce((s,r)=>s+Number(r.usageKwh),0)*102)+i*112)}));
  const maxSave=Math.max(...buildingTotals.map(x=>x.savings),1);
  const radarValues=[82,67,46,74,58];
  const actions=`<button class="button button-analysis inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="run-analysis">✦ Run Full Analysis</button><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="generate-report">▣ Generate Report</button>`;
  return `${pageHeading('Advanced Energy Intelligence','Explore transparent, illustrative calculations using the built-in demo dataset.','ENERGY ANALYTICS',actions)}${demoNotice('Forecast lines, confidence bands, efficiency indices, and pattern summaries below are deterministic illustrations—not validated predictions or AI output.')}
    ${analysisOutput ? `<div class="operation-result" role="status">${esc(analysisOutput)}</div>` : ''}
    <section class="analytics-kpi-grid">${metricCard('ϟ','188,153 kWh','Total consumption','Illustrative annual scenario')}${metricCard('$','$4,287','Estimated savings','Scenario estimate · not bill data','blue')}${metricCard('◉','96.8%','Efficiency index','Example score · not a measured KPI','mint')}${metricCard('≈','96.8%','Sample trend fit','Illustrative only · not validated accuracy','violet')}</section>
    <section class="analytics-grid-two"><article class="panel analytics-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Energy Consumption Trends','Simulated actual consumption versus illustrative target.',rangeButtons('analytics',trend,['Week','Month','Year']))}${energyChart(trend,true)}</article><article class="panel analytics-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Energy Forecasting',`30-day demonstration forecast with an illustrative ±12% interval${forecastUpdatedAt ? ` · recalculated ${forecastUpdatedAt}` : ''}.`,`<button class="button button-small inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="update-forecast">↻ Update Forecast</button>`)}${forecastChart(forecast)}</article></section>
    <section class="analytics-grid-two"><article class="panel analytics-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Savings by Building','Scenario estimates · USD · demo only')}<div class="building-bars">${buildingTotals.map(item=>`<div class="building-bar-row"><span>${esc(item.building)}</span><div class="bar-track"><span style="width:${item.savings/maxSave*100}%"></span></div><b>${currency(item.savings)}</b></div>`).join('')}</div><p class="panel-footnote">Illustrative comparisons only; no utility bills are connected.</p></article><article class="panel analytics-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Usage Pattern Analysis','Normalized demo signals · no occupancy sensors connected')}<div class="radar-wrap">${radarChart(radarValues)}<div class="radar-insights"><strong>Pattern insight</strong><span class="confidence-pill">Sample confidence 92%</span><p>Morning peak example · based on deterministic sample values.</p><strong>Off-hours signal</strong><span class="confidence-pill amber">Illustrative 87%</span><p>Possible idle consumption is a review prompt, not a prediction.</p></div></div></article></section>
    <section class="analytics-grid-two"><article class="panel parameter-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Mathematical demonstration parameters','Adjust the deterministic example calculations.')}<div class="parameter-row"><label for="param-recurrence">Recurrence weighting</label><input id="param-recurrence" data-param="recurrence" type="range" min="10" max="95" value="${Number(state.params.recurrence)}"/><output>${Number(state.params.recurrence)}%</output></div><div class="parameter-row"><label for="param-threshold">Possible-waste threshold</label><input id="param-threshold" data-param="threshold" type="range" min="0.2" max="3" step="0.1" value="${Number(state.params.threshold)}"/><output>${Number(state.params.threshold).toFixed(1)} kWh</output></div><div class="parameter-row"><label for="param-probability">Occupancy display threshold</label><input id="param-probability" data-param="probability" type="range" min="30" max="95" value="${Number(state.params.probability)}"/><output>${Number(state.params.probability)}%</output></div><div class="model-notes"><span>R<sub>n</sub> = wR<sub>n−1</sub> + (1−w) × sample</span><span>Function analysis · interval width ±12%</span><span>Rule evaluation · energy ∧ vacancy ∧ timetable</span></div><p class="panel-footnote">The threshold slider updates possible-waste alerts throughout EcoCampus. It does not alter a real device or sensor.</p></article><article class="panel analytics-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Advanced Pattern Recognition','A deterministic scatter illustration and named sample insights.')}<div class="scatter-area">${scatterChart()}</div><div class="pattern-cards"><div><span class="pattern-dot morning"></span><strong>Morning peak</strong><small>92% illustrative confidence</small></div><div><span class="pattern-dot evening"></span><strong>Evening reduction</strong><small>87% illustrative confidence</small></div></div>${insightOutput ? `<p class="operation-result insight-result" role="status">${esc(insightOutput)}</p>` : ''}<button class="button button-analysis inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="generate-insights">✦ Generate demo insights</button></article></section>`;
}
function forecastChart(data) {
  const width=720,height=210,all=[...data.history,...data.forecast],max=Math.max(...all)*1.12,step=width/(all.length-1);
  const point=(v,i)=>[i*step,height-22-v/max*(height-48)];
  const path=values=>values.map((v,i)=>{const [x,y]=point(v,i+(values===data.forecast?data.history.length-1:0));return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`}).join(' ');
  const upper=data.upper.map((v,i)=>point(v,i+data.history.length-1));const lower=[...data.lower].reverse().map((v,i)=>point(v,data.history.length+data.lower.length-1-i));
  const band=`${upper.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} ${lower.map(([x,y])=>`L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} Z`;
  const histPath=path(data.history);const fcPoints=data.forecast.map((v,i)=>{const [x,y]=point(v,i+data.history.length-1);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`}).join(' ');
  return `<div class="forecast-wrap"><svg viewBox="0 0 ${width} ${height}" class="forecast-svg" role="img" aria-label="Illustrative 30 day forecast with a simulated confidence interval">${[0,1,2,3,4].map(i=>`<line x1="0" y1="${24+i*39}" x2="${width}" y2="${24+i*39}" class="chart-gridline"/>`).join('')}<path d="${band}" class="forecast-band"/><path d="${histPath}" class="forecast-history"/><path d="${fcPoints}" class="forecast-line"/><line x1="${point(data.history.at(-1),data.history.length-1)[0]}" y1="15" x2="${point(data.history.at(-1),data.history.length-1)[0]}" y2="${height-18}" class="forecast-divider"/></svg><div class="forecast-labels"><span>Past 12 sample periods</span><span>Next 30 demo days</span></div><div class="chart-legend"><span><i class="legend-line historical"></i>Historical sample</span><span><i class="legend-line forecast"></i>Forecast illustration</span><span><i class="legend-band"></i>±12% illustrative range</span></div></div>`;
}
function radarChart(values) {
  const cx=130,cy=112,r=78,angles=[-90,-18,54,126,198];
  const polygon=(scale)=>values.map((v,i)=>`${cx+Math.cos(angles[i]*Math.PI/180)*r*scale*v/100},${cy+Math.sin(angles[i]*Math.PI/180)*r*scale*v/100}`).join(' ');
  const labels=['Morning','Midday','Evening','Off-hours','Weekend'];
  return `<svg viewBox="0 0 260 235" class="radar-svg" role="img" aria-label="Illustrative room energy-use pattern radar"><g>${[.25,.5,.75,1].map(scale=>`<polygon points="${angles.map(a=>`${cx+Math.cos(a*Math.PI/180)*r*scale},${cy+Math.sin(a*Math.PI/180)*r*scale}`).join(' ')}" class="radar-grid"/>`).join('')}${angles.map(a=>`<line x1="${cx}" y1="${cy}" x2="${cx+Math.cos(a*Math.PI/180)*r}" y2="${cy+Math.sin(a*Math.PI/180)*r}" class="radar-axis"/>`).join('')}<polygon points="${polygon(1)}" class="radar-data"/>${values.map((v,i)=>`<circle cx="${cx+Math.cos(angles[i]*Math.PI/180)*r*v/100}" cy="${cy+Math.sin(angles[i]*Math.PI/180)*r*v/100}" r="3.5" class="radar-point"/>`).join('')}</g>${labels.map((label,i)=>`<text x="${cx+Math.cos(angles[i]*Math.PI/180)*(r+20)}" y="${cy+Math.sin(angles[i]*Math.PI/180)*(r+20)+3}" text-anchor="middle">${label}</text>`).join('')}</svg>`;
}
function scatterChart() {
  const pts=Array.from({length:38},(_,i)=>{const x=36+((i*37)%265),y=24+((i*53+i*i*7)%120);const cls=i%3===0?'cluster-high':i%3===1?'cluster-mid':'cluster-low';return `<circle cx="${x}" cy="${y}" r="${3+(i%3)}" class="${cls}"/>`}).join('');
  return `<svg viewBox="0 0 330 180" role="img" aria-label="Illustrative sample usage-pattern clusters"><line x1="28" y1="150" x2="320" y2="150" class="scatter-axis"/><line x1="28" y1="12" x2="28" y2="150" class="scatter-axis"/><text x="160" y="173" text-anchor="middle">Time of day (sample)</text><text x="11" y="88" transform="rotate(-90 11 88)" text-anchor="middle">Energy use</text>${pts}<text x="46" y="34" class="scatter-label">Morning</text><text x="210" y="42" class="scatter-label">Class hours</text><text x="225" y="129" class="scatter-label">Low use</text></svg>`;
}

let controlFilters = { building: 'All', roomType: 'All', type: 'All', voltage: 'All', search: '' };
function controlView() {
  const devices=filteredDevices();
  const counts=state.devices.reduce((a,d)=>(a[d.status]=(a[d.status]||0)+1,a),{online:0,offline:0,issue:0});
  const filters=`<aside class="panel control-sidebar min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm"><div class="filter-title">⌄ Control Filters</div>${filterChoices('Building',['All','A','B','C','D','E'],'building')}${filterChoices('Room Type',['All','Classroom','Laboratory','Office','Library','Hallway','Auditorium'],'roomType')}${filterChoices('Device Type',['All','Light','AC','Computer','Projector','Fan','Printer'],'type')}${filterChoices('Voltage',['All','110','220'],'voltage')}<label class="filter-search">⌕ <input id="device-search" value="${esc(controlFilters.search)}" placeholder="Device ID, name…"/></label><div class="safety-actions"><button class="emergency-button ${state.emergency?'selected':''}" data-safety="emergency">⚠ Emergency</button><button class="safe-button ${state.safeMode?'selected':''}" data-safety="safe">⬡ ${state.safeMode?'Safe Mode ON':'Safe Mode'}</button></div><div class="auto-schedule-card"><label class="switch-row"><span>⚙ Rule-based auto-schedule</span><input type="checkbox" data-auto-schedule ${state.autoSchedule?'checked':''}/><i class="switch"></i></label><p>Optimization mode <strong>${state.autoSchedule?'High efficiency':'Manual demo'}</strong></p><small>Next example check: tomorrow · 2:00 AM</small><p class="side-disclaimer">This switch changes the demo UI only; it does not operate equipment.</p></div></aside>`;
  return `${pageHeading('Smart Auto Control System','Review simulated device profiles and schedules. Controls update shared demo records only.','SMART CONTROL',`<button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-open-schedule-form>＋ New schedule</button>`)}${demoNotice('No connected hardware. Device toggles, Safe Mode, Emergency Mode, and schedules do not control real equipment.')}
    <section class="control-kpis">${metricCard('●',String(counts.online),'Devices online','Sample status only')}${metricCard('◌',String(counts.offline),'Devices offline','Sample status only','blue')}${metricCard('△',String(counts.issue),'Devices with issues','Demo flags only','amber')}${metricCard('ϟ','154 kWh','Energy saved','Illustrative sample total','mint')}</section>
    <div class="control-layout">${filters}<section class="control-content"><article class="panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle(`Controlled Devices (${devices.length})`,'Filter the sample set by building, room, device type, voltage, or search.')}<div id="device-grid-container" class="device-grid full-device-grid">${devices.map(deviceCard).join('')||'<div class="empty-state"><strong>No devices match the filters</strong><span>Change a filter or search term.</span></div>'}</div><p class="panel-footnote">Green/amber/gray dots show simulated status. Offline profile controls are disabled in this demo.</p></article>
      <article class="panel schedule-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Automation Schedules','Rule-based examples · saved in the shared demo database.',`<button class="button button-small inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-open-schedule-form>＋ Add schedule</button>`)}<div class="table-scroll"><table class="data-table schedule-table"><thead><tr><th>Name</th><th>Target</th><th>Time / Trigger</th><th>Action</th><th>Status</th><th>Manage</th></tr></thead><tbody>${state.schedules.map(schedule=>`<tr><td><strong>${esc(schedule.name)}</strong><small class="cell-demo">Rule-based demo</small></td><td>${esc(schedule.target)}</td><td>${esc(schedule.trigger)}</td><td>${esc(schedule.action)}</td><td><button class="status-pill ${schedule.status==='Active'?'active-schedule':'inactive-schedule'}" data-schedule-toggle="${esc(schedule.id)}">${esc(schedule.status)}</button></td><td><div class="row-actions"><button class="table-action" data-schedule-edit="${esc(schedule.id)}">Edit</button><button class="table-action danger-text" data-schedule-delete="${esc(schedule.id)}">Delete</button></div></td></tr>`).join('')||'<tr><td colspan="6">No schedules yet.</td></tr>'}</tbody></table></div><p class="panel-footnote">Schedules are examples. They are not connected to a building-management system.</p></article></section></div>`;
}
function filterChoices(label,options,group) {
  return `<div class="filter-block"><h3>${label}</h3><div class="filter-options">${options.map(value=>`<button class="filter-option ${controlFilters[group]===value?'active':''}" data-device-filter="${group}" data-value="${value}" type="button">${value==='All'?'All':value}</button>`).join('')}</div></div>`;
}
function filteredDevices() {
  const f=controlFilters;
  return state.devices.filter(d=>(f.building==='All'||d.buildingCode===f.building)&&(f.roomType==='All'||d.roomType===f.roomType)&&(f.type==='All'||d.type===f.type)&&(f.voltage==='All'||String(d.voltage)===f.voltage)&&(!f.search||`${d.name} ${d.id} ${d.location} ${d.room}`.toLowerCase().includes(f.search.toLowerCase())));
}
function deviceCard(device) {
  return `<article class="control-device-card status-border-${device.status}"><div class="control-device-top"><strong>${esc(device.name)}</strong><span class="device-status status-${device.status}" title="${device.status}"></span></div><div class="device-info-grid"><span>Location<strong>${esc(device.location)}</strong></span><span>Room<strong>${esc(device.room)}</strong></span><span>Bldg<strong>${esc(device.buildingCode)}</strong></span><span>Voltage<strong>${device.voltage}V</strong></span><span>Power<strong>${device.powerW}W</strong></span><span>Saved<strong>${device.savedKwh} kWh</strong></span></div><div class="control-device-actions"><button type="button" class="device-toggle ${device.on?'on':''}" data-device-toggle="${esc(device.id)}" data-device-state="on" ${device.status==='offline'?'disabled':''}>On</button><button type="button" class="device-toggle ${!device.on?'off-active':''}" data-device-toggle="${esc(device.id)}" data-device-state="off" ${device.status==='offline'?'disabled':''}>Off</button></div><small class="device-source">${device.status==='online'?'Online sample':device.status==='offline'?'Offline sample':'Issue flag · simulated'}</small></article>`;
}
function scheduleForm(schedule=null) {
  return `<div class="modal-backdrop" data-close-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title"><header class="modal-header"><div><h2 id="schedule-modal-title">${schedule?'Edit schedule':'Add automation schedule'}</h2><p>Rule-based demonstration schedule; no hardware is connected.</p></div><button class="close-button" data-close-modal aria-label="Close">×</button></header><form class="modal-form" id="schedule-form" data-schedule-id="${schedule?esc(schedule.id):''}"><div class="form-field"><label for="schedule-name">Name</label><input id="schedule-name" name="name" required maxlength="90" value="${schedule?esc(schedule.name):''}" placeholder="e.g. Evening shutdown"/></div><div class="form-field"><label for="schedule-target">Target</label><input id="schedule-target" name="target" required maxlength="120" value="${schedule?esc(schedule.target):''}" placeholder="Classrooms · Building A"/></div><div class="form-field"><label for="schedule-trigger">Time / Trigger</label><input id="schedule-trigger" name="trigger" required maxlength="120" value="${schedule?esc(schedule.trigger):''}" placeholder="Weekdays · 7:30 AM"/></div><div class="form-field"><label for="schedule-action">Suggested action</label><input id="schedule-action" name="action" required maxlength="240" value="${schedule?esc(schedule.action):''}" placeholder="Review lights and HVAC"/></div><div class="form-field"><label for="schedule-status">Status</label><select name="status" id="schedule-status"><option ${schedule?.status==='Active'?'selected':''}>Active</option><option ${schedule?.status==='Inactive'?'selected':''}>Inactive</option></select></div><div class="modal-actions"><button class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" type="button" data-close-modal>Cancel</button><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition">${schedule?'Save schedule':'Add schedule'}</button></div></form></section></div>`;
}

function reportsView() {
  const rows=filteredReportRows();
  reportRowsCache=rows;
  const sum=rows.reduce((a,r)=>a+r.energy,0),saved=rows.reduce((a,r)=>a+r.savings,0),co2=rows.reduce((a,r)=>a+r.co2,0);
  const actions=`<button class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="export-csv">⇩ CSV</button><button class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="export-excel">▤ Excel</button><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="print-report">▣ Save PDF</button>`;
  const tableRows=rows.slice(-35).reverse().map(row=>`<tr><td>${row.label}</td><td>${row.energy.toLocaleString()}</td><td>${currency(row.savings)}</td><td>${row.co2.toLocaleString()}</td><td>${row.efficiency}%</td></tr>`).join('');
  const chart=reportChart(rows.slice(-45));
  return `${pageHeading('Energy Reports','Create a sample report for a selected period and export the current preview.','REPORT BUILDER',actions)}${demoNotice('Reports are generated from a deterministic sample series and local room readings; figures are not actual utility, cost, savings, or emissions records.')}
    <section class="report-module-grid"><article class="report-module-card"><span class="module-icon">▤</span><div><strong>Report Generator</strong><p>Choose a period and prepare the sample summary below.</p></div><button class="button button-small inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="generate-report">Generate</button></article><article class="report-module-card"><span class="module-icon certificate">✧</span><div><strong>Savings Certificate</strong><p>Create an illustrative certificate preview.</p></div><button class="button button-small inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="certificate">Preview</button></article><article class="report-module-card"><span class="module-icon export">⇩</span><div><strong>Data Export</strong><p>Download CSV or Excel-compatible files; print to PDF.</p></div><button class="button button-small inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="export-csv">Export</button></article></section>
    <section class="panel report-filter-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Report period','Select a quick preset or enter a custom date range.')}<div class="report-filters"><div class="filter-chips">${[['Last 7 Days','Last 7 Days'],['Last Month','Last Month'],['Last 90 Days','Last 90 Days'],['Year to Date','Year to Date'],['Custom','Custom']].map(([v,l])=>`<button class="filter-chip ${state.reportPreset===v?'active':''}" data-report-preset="${v}" type="button">${l}</button>`).join('')}</div><label>From<input type="date" id="report-from" value="${esc(state.reportFrom)}" ${state.reportPreset==='Custom'?'':'disabled'}/></label><label>To<input type="date" id="report-to" value="${esc(state.reportTo)}" ${state.reportPreset==='Custom'?'':'disabled'}/></label></div></section>
    <section class="report-summary-cards">${metricCard('ϟ',`${sum.toLocaleString()} kWh`,'Energy consumption',`${rows.length} sample days`)}${metricCard('$',currency(saved),'Cost savings','Illustrative scenario','blue')}${metricCard('♧',`${co2.toLocaleString()} kg`,'CO₂ reduction','Illustrative equivalent','mint')}${metricCard('◉',`${rows.length?Math.round(rows.reduce((a,r)=>a+r.efficiency,0)/rows.length):0}%`,'Efficiency index','Synthetic example','violet')}</section>
    <section class="panel report-chart-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Energy vs savings','Simulated daily consumption and illustrative savings.')}<div id="report-chart">${chart}</div></section>
    <section class="panel report-table-panel min-w-0 rounded-[13px] border bg-white p-[17px_18px] shadow-sm">${panelTitle('Report preview',`${rows.length} sample daily rows · latest 35 shown.`)}<div class="table-scroll"><table class="data-table report-data-table"><thead><tr><th>Date</th><th>Energy Consumption (kWh)</th><th>Cost Savings ($)</th><th>CO₂ Reduction (kg)</th><th>Efficiency (%)</th></tr></thead><tbody>${tableRows||'<tr><td colspan="5">No sample rows for this date range.</td></tr>'}</tbody></table></div><p class="panel-footnote">The figures above are simulated examples. CSV/Excel/PDF exports are demo outputs and should not be used as audited records.</p></section>`;
}
function filteredReportRows() {
  const all=makeReportRows(365),today=new Date();
  if(state.reportPreset==='Custom'){
    const from=state.reportFrom?new Date(`${state.reportFrom}T00:00:00`):new Date(today.getTime()-6*864e5);
    const to=state.reportTo?new Date(`${state.reportTo}T23:59:59`):today;
    return all.filter(row=>row.date>=from&&row.date<=to);
  }
  const count=state.reportPreset==='Last 7 Days'?7:state.reportPreset==='Last Month'?30:state.reportPreset==='Last 90 Days'?90:Math.max(1,Math.floor((today-new Date(today.getFullYear(),0,1))/864e5)+1);
  return all.slice(-count);
}
function reportChart(rows) {
  if(!rows.length)return '<div class="empty-state">Select dates containing sample records.</div>';
  const width=880,height=220,step=width/rows.length,max=Math.max(...rows.map(r=>r.energy)),maxSave=Math.max(...rows.map(r=>r.savings));
  const bars=rows.map((row,i)=>{const bh=row.energy/max*(height-45);return `<rect x="${i*step+1}" y="${height-28-bh}" width="${Math.max(1,step-2)}" height="${bh}" rx="1" class="report-bar"/>`}).join('');
  const points=rows.map((r,i)=>`${(i+.5)*step},${height-28-r.savings/maxSave*(height-50)}`).join(' ');
  return `<div class="report-plot-wrap"><svg viewBox="0 0 ${width} ${height}" class="report-plot" role="img" aria-label="Simulated daily energy bars with illustrative savings line">${[0,1,2,3].map(i=>`<line x1="0" y1="${18+i*54}" x2="${width}" y2="${18+i*54}" class="chart-gridline"/>`).join('')}${bars}<polyline points="${points}" class="report-savings-line"/></svg><div class="report-plot-legend"><span><i class="legend-square"></i>Energy consumption</span><span><i class="legend-line savings"></i>Illustrative savings</span></div></div>`;
}

function businessView() {
  const rooms=state.rooms.length;
  return `${pageHeading('Business Model','A practical concept for turning room-level energy awareness into campus action.','ECOSMART CAMPUS PROPOSAL',`<button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-page="dashboard">Explore demo dashboard →</button>`)}${demoNotice('This is a concept model, not a commercial offer. Pricing, savings, and return assumptions below are illustrative and not guaranteed.')}
    <section class="business-hero"><div><span class="hero-kicker">A CAMPUS-FIRST APPROACH</span><h2>Start with visibility.<br/><em>Scale with evidence.</em></h2><p>EcoCampus can begin as a low-friction energy-awareness pilot: combine existing room schedules with sample or future meter readings, then have facilities teams verify suggested actions.</p></div><div class="business-loop"><span>Read</span><b>→</b><span>Compare</span><b>→</b><span>Review</span><b>→</b><span>Improve</span></div></section>
    <div class="business-grid"><article class="business-card"><span class="business-step">01</span><h3>Campus pilot</h3><p>Map a small set of rooms, document schedules, and validate the rule thresholds with facilities staff.</p><ul><li>${rooms} demo rooms currently modeled</li><li>Sample data runs without sensors</li><li>Human review remains in the loop</li></ul></article><article class="business-card featured"><span class="business-step">02</span><h3>Measured rollout</h3><p>Compare verified meter readings and occupancy/timetable records before making any savings claim.</p><ul><li>Agree on data sources and ownership</li><li>Integrate only approved systems</li><li>Track outcomes against a baseline</li></ul></article><article class="business-card"><span class="business-step">03</span><h3>Operations support</h3><p>Keep room data, alerts, and maintenance actions visible to energy and facilities teams.</p><ul><li>Review alerts and close the loop</li><li>Build repeatable reporting</li><li>Expand room coverage thoughtfully</li></ul></article></div>
    <section class="business-value"><div><span class="eyebrow">ILLUSTRATIVE SCENARIO</span><h2>Estimate a pilot baseline</h2><p>Use the current sample assumption to see how a future measured reduction could be framed. This is not a savings promise.</p></div><div class="roi-card"><label>Rooms in pilot<input id="roi-rooms" type="number" min="1" max="10000" value="${rooms}"/></label><label>Monthly energy budget ($)<input id="roi-budget" type="number" min="0" step="100" value="25000"/></label><label>Scenario reduction (%)<input id="roi-reduction" type="number" min="0" max="50" step="1" value="8"/></label><div class="roi-result"><small>Illustrative monthly opportunity</small><strong id="roi-result">${currency(25000*.08)}</strong><span>Only if a future measured pilot supports the assumption.</span></div></div></section>
    <section class="math-strip"><div><span class="eyebrow">VALUE PROPOSITION</span><h2>Explainable, incremental, and accountable.</h2><p>The prototype demonstrates the information flow. A production rollout would require institution-approved sensors/data access, security review, and measured validation.</p></div><div class="math-cards"><span><b>01</b> Energy visibility</span><span><b>02</b> Rule review</span><span><b>03</b> Human action</span><span><b>04</b> Verified reporting</span></div></section>`;
}

function render() {
  if (!databaseReady) { renderDatabaseGate(); return; }
  const target=pages[currentPage]?currentPage:'home';
  const navTarget=target==='rooms'||target==='alerts'?'dashboard':target;
  $$('.nav-link').forEach(button=>{const active=button.dataset.page===navTarget;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
  const views={home:homeView,dashboard:dashboardView,layout:layoutView,analytics:analyticsView,control:controlView,reports:reportsView,business:businessView,rooms:roomsView,alerts:alertsView};
  $('#main-content').innerHTML=(views[target]||homeView)();
  const header = $('.site-header');
  const menu = $('[data-action="toggle-nav"]');
  if (header && menu) menu.setAttribute('aria-expanded', header.classList.contains('nav-open') ? 'true' : 'false');
}
function setPage(page) {
  if(!pages[page])return;
  if(window.location.hash!==`#${page}`)window.history.pushState({page},'',`#${page}`);
  currentPage=page;
  $('.site-header')?.classList.remove('nav-open');
  $('[data-action="toggle-nav"]')?.setAttribute('aria-expanded','false');
  render();
  window.scrollTo({top:0,behavior:'smooth'});
}
function openRoomForm(roomId='',mode='reading') {
  const room=state.rooms.find(item=>item.id===roomId)||null;
  $('#modal-root').innerHTML=roomForm(room,mode);
  $('#room-name')?.focus();
}
function openScheduleForm(id='') {
  const schedule=state.schedules.find(item=>item.id===id)||null;
  $('#modal-root').innerHTML=scheduleForm(schedule);
  $('#schedule-name')?.focus();
}
function closeModal() { $('#modal-root').innerHTML=''; }
function makeRoomCode(name) {
  let code=name.split(/\s+/).map(part=>part.replace(/[^a-z0-9]/gi,'')[0]||'').join('').toUpperCase().slice(0,3)||'RM';
  if(state.rooms.some(room=>room.code===code)) code=`${code}${state.rooms.length+1}`.slice(0,5);
  let suffix=2;const original=code;while(state.rooms.some(room=>room.code===code)){code=`${original}${suffix++}`.slice(0,5)}
  return code;
}
function addRoom(values, mode='reading') {
  const id=`room-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const code=makeRoomCode(values.name);
  const i=state.rooms.length;
  state.rooms.push({id,code,name:values.name,building:values.building||'Campus',buildingCode:(values.buildingCode||values.building||'A').match(/[A-E]/i)?.[0]?.toUpperCase()||'A',type:values.type||'Classroom',capacity:Number(values.capacity)||30,usageKwh:Number(values.usageKwh)||0,occupied:values.occupied==='true',scheduled:values.scheduled==='true',graphX:125+(i%4)*150,graphY:100+Math.floor(i/4)*125});
  if(mode==='layout') selectedRoomCode=code;
}
function createPathway(from,to,distance) {
  if(from===to){showToast('Choose two different rooms for a pathway.','info');return false}
  if(state.pathways.some(e=>(e.from===from&&e.to===to)||(e.from===to&&e.to===from))){showToast('A pathway already connects those rooms.','info');return false}
  state.pathways.push({id:`edge-${Date.now()}`,from,to,distance:Number(distance)||50});graphResult={type:'none',edges:[],nodes:[],path:[],distance:0};persist('Sample pathway added to the campus graph.');render();return true;
}
function runGraphAnalysis(type) {
  if(type==='mst'){
    const result=calculateMST(state.rooms,state.pathways);
    graphResult={type:'mst',edges:result.edges,nodes:[],path:[],distance:result.total,connected:result.connected};
    showToast(result.connected?`MST found: ${result.edges.length} pathways · ${result.total} m total.`:'Graph disconnected. Add connecting pathways to span every room.');
  } else if(type==='sensors'){
    const result=optimizeSensorPlacement(state.rooms,state.pathways);
    graphResult={type:'sensors',edges:[],nodes:result.map(x=>x.room),path:[],distance:0};
    showToast(`Coverage suggestion: ${result.length} sample sensor locations. No hardware is installed.`,'info');
  } else if(type==='shortest'){
    const from=$('#path-from')?.value||state.rooms[0]?.code;const to=$('#path-to')?.value||state.rooms.at(-1)?.code;
    const result=calculateShortestPath(state.rooms,state.pathways,from,to);
    if(!result.path.length){showToast('No connected path. Add a pathway between these campus areas.','info');return}
    graphResult={type:'shortest',edges:[],nodes:[],path:result.path,distance:result.distance};
    showToast(`Shortest sample route: ${result.distance} m.`);
  }
  render();
}
function applyDeviceFiltersOnly() {
  const container=$('#device-grid-container');if(container)container.innerHTML=filteredDevices().map(deviceCard).join('')||'<div class="empty-state"><strong>No devices match the filters</strong><span>Change a filter or search term.</span></div>';
}
function exportBlob(content,type,filename) {
  const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);showToast(`${filename} downloaded.`);
}
function reportExportRows() {
  return reportRowsCache.length?reportRowsCache:filteredReportRows();
}
function exportCsv() {
  const rows=reportExportRows();
  const lines=[['Date','Energy Consumption (kWh)','Cost Savings ($)','CO2 Reduction (kg)','Efficiency (%)'],...rows.map(r=>[r.label,r.energy,r.savings,r.co2,r.efficiency])];
  const csv='\ufeff'+lines.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  exportBlob(csv,'text/csv;charset=utf-8',`ecocampus-simulated-report-${new Date().toISOString().slice(0,10)}.csv`);
}
function exportExcel() {
  const rows=reportExportRows();
  const table=`<table><thead><tr><th>Date</th><th>Energy Consumption (kWh)</th><th>Cost Savings ($)</th><th>CO2 Reduction (kg)</th><th>Efficiency (%)</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.energy}</td><td>${r.savings}</td><td>${r.co2}</td><td>${r.efficiency}</td></tr>`).join('')}</tbody></table>`;
  const html=`<html><head><meta charset="utf-8"></head><body><h1>EcoCampus · Simulated Report</h1><p>DEMO DATA ONLY · Not audited utility or savings data.</p>${table}</body></html>`;
  exportBlob(`\ufeff${html}`,'application/vnd.ms-excel;charset=utf-8',`ecocampus-simulated-report-${new Date().toISOString().slice(0,10)}.xls`);
}
function openCertificate() {
  const rows=reportExportRows();const energy=rows.reduce((sum,row)=>sum+row.energy,0);const savings=rows.reduce((sum,row)=>sum+row.savings,0);
  $('#modal-root').innerHTML=`<div class="modal-backdrop" data-close-backdrop><section class="modal certificate-modal" role="dialog" aria-modal="true" aria-labelledby="certificate-title"><header class="modal-header"><div><h2 id="certificate-title">Illustrative Savings Certificate</h2><p>Demo scenario · not an official verification.</p></div><button class="close-button" data-close-modal aria-label="Close">×</button></header><div class="certificate-body"><div class="certificate-mark">♧</div><span>ECOCAMPUS · SAMPLE CERTIFICATE</span><h3>Energy awareness in action</h3><p>For the selected sample report period</p><strong>${energy.toLocaleString()} kWh</strong><small>illustrative energy series · ${currency(savings)} estimated savings</small><div class="certificate-disclaimer">Simulated example only. No measured or verified emissions/savings claim.</div></div><div class="modal-actions"><button class="button button-secondary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-close-modal>Close</button><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-action="print-report">Print certificate</button></div></section></div>`;
}
function setReportPreset(preset) {state.reportPreset=preset;if(preset!=='Custom'){state.reportFrom='';state.reportTo=''}persist();render()}
function showHelp(title,body) {$('#modal-root').innerHTML=`<div class="modal-backdrop" data-close-backdrop><section class="modal"><header class="modal-header"><div><h2>${esc(title)}</h2><p>${esc(body)}</p></div><button class="close-button" data-close-modal aria-label="Close">×</button></header><div class="modal-actions"><button class="button button-primary inline-flex items-center justify-center gap-[7px] rounded-[8px] border px-[13px] text-[10px] font-bold transition" data-close-modal>Got it</button></div></section></div>`}

// Page navigation and all delegated UI actions.
document.addEventListener('click',event=>{
  const target=event.target;
  const action=target.closest('[data-action]')?.dataset.action;
  if(action==='toggle-nav'){
    const header=$('.site-header');const menu=target.closest('[data-action="toggle-nav"]');
    const expanded=header?.classList.toggle('nav-open')||false;
    menu?.setAttribute('aria-expanded',expanded?'true':'false');return;
  }
  if(action==='retry-database'){loadSharedState();return}
  if(action==='retry-save'){persist('Shared state saved to the database.');return}
  const page=target.closest('[data-page]');if(page){if(page.matches('a'))event.preventDefault();setPage(page.dataset.page);return}
  if(action==='run-analysis'){
    analyticsRun++;
    const flagged=getAlerts();
    const highest=[...state.rooms].sort((a,b)=>Number(b.usageKwh)-Number(a.usageKwh))[0];
    analysisOutput=`Analysis ${analyticsRun} checked ${state.rooms.length} simulated rooms: ${flagged.length} possible rule flags; highest reading ${highest?`${highest.name} · ${Number(highest.usageKwh).toFixed(1)} kWh`:'no room readings'}.`;
    render();showToast('Rule-based sample analysis recalculated. No AI or external data used.','info');return;
  }
  if(action==='generate-report'){state.reportPreset=state.reportPreset||'Last 7 Days';persist('Report settings saved to the shared demo database.');if(currentPage!=='reports')setPage('reports');else{render();showToast('Simulated report preview generated.')};return}
  if(action==='update-forecast'){
    forecastUpdatedAt=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    render();showToast('Illustrative 30-day forecast recalculated from the current demo parameters.','info');return;
  }
  if(action==='generate-insights'){
    const flagged=getAlerts();
    const highest=[...state.rooms].sort((a,b)=>Number(b.usageKwh)-Number(a.usageKwh))[0];
    insightOutput=flagged.length?`${flagged.length} rooms meet the transparent review rule; start with ${flagged[0].room.name}. Verify occupancy and timetable before acting.`:highest?`No rooms currently meet the wastage rule. Highest sample reading: ${highest.name} at ${Number(highest.usageKwh).toFixed(1)} kWh.`:'No sample rooms are available.';
    render();showToast('A room-based sample insight was generated; it is not an AI conclusion.','info');return;
  }
  if(action==='export-csv'){exportCsv();return}
  if(action==='export-excel'){exportExcel();return}
  if(action==='print-report'){
    if($('.certificate-modal')){
      document.body.classList.add('printing-certificate');
      window.addEventListener('afterprint',()=>document.body.classList.remove('printing-certificate'),{once:true});
    }
    window.print();return;
  }
  if(action==='certificate'){openCertificate();return}
  if(action==='reset-demo'){resetSharedDemo();return}
  if(target.closest('[data-open-room-form]')){openRoomForm();return}
  if(target.closest('[data-open-schedule-form]')){openScheduleForm();return}
  if(target.closest('[data-close-modal]')){closeModal();return}
  if(target.matches('[data-close-backdrop]')){closeModal();return}
  const editRoom=target.closest('[data-edit-room]');if(editRoom){openRoomForm(editRoom.dataset.editRoom);return}
  const roomFilterBtn=target.closest('[data-room-filter]');if(roomFilterBtn){roomFilter=roomFilterBtn.dataset.roomFilter;render();return}
  const alertFilterBtn=target.closest('[data-alert-filter]');if(alertFilterBtn){alertFilter=alertFilterBtn.dataset.alertFilter;render();return}
  const review=target.closest('[data-review-room]');if(review){const id=review.dataset.reviewRoom;if(!state.reviewed.includes(id))state.reviewed.push(id);persist('Alert marked reviewed; its rule status remains active.');render();return}
  const range=target.closest('[data-range-group]');if(range){if(range.dataset.rangeGroup==='dashboard')state.dashboardRange=range.dataset.range;else state.analyticsRange=range.dataset.range;persist();render();return}
  const mode=target.closest('[data-graph-mode]');if(mode){graphMode=mode.dataset.graphMode;graphSelection=[];render();return}
  if(target.closest('[data-graph-clear]')){graphResult={type:'none',edges:[],nodes:[],path:[],distance:0};graphSelection=[];graphMode='select';render();return}
  const analyze=target.closest('[data-graph-analysis]');if(analyze){runGraphAnalysis(analyze.dataset.graphAnalysis);return}
  const roomCard=target.closest('[data-select-room]');if(roomCard){selectedRoomCode=roomCard.dataset.selectRoom;render();return}
  const delRoom=target.closest('[data-delete-room]');if(delRoom){const room=state.rooms.find(item=>item.id===delRoom.dataset.deleteRoom);if(room&&window.confirm(`Delete “${room.name}” and its attached pathways from the shared demo database for everyone using this app?`)){state.rooms=state.rooms.filter(item=>item.id!==room.id);state.pathways=state.pathways.filter(edge=>edge.from!==room.code&&edge.to!==room.code);state.reviewed=state.reviewed.filter(id=>id!==room.id);selectedRoomCode=state.rooms[0]?.code||'';graphResult={type:'none',edges:[],nodes:[],path:[],distance:0};persist('Room removed from the sample graph.');render()}return}
  const node=target.closest('[data-node-code]');if(node){const code=node.dataset.nodeCode;if(graphMode==='pathway'){graphSelection.push(code);if(graphSelection.length===2){createPathway(graphSelection[0],graphSelection[1],Number($('#path-distance')?.value)||60);graphSelection=[]}else{selectedRoomCode=code;showToast(`Start selected: ${code}. Choose another node to add a pathway.`,'info');render()}}else if(graphMode==='room'){openRoomForm('', 'layout')}else{selectedRoomCode=code;render()}return}
  const device=target.closest('[data-device-toggle]');if(device){const item=state.devices.find(d=>d.id===device.dataset.deviceToggle);if(!item||item.status==='offline')return;item.on=device.dataset.deviceState==='on';persist(`${item.name} sample state set ${item.on?'On':'Off'} · no physical device was changed.`,'info');render();return}
  const filter=target.closest('[data-device-filter]');if(filter){controlFilters[filter.dataset.deviceFilter]=filter.dataset.value;render();return}
  const safety=target.closest('[data-safety]');if(safety){if(safety.dataset.safety==='emergency'){state.emergency=!state.emergency;persist(state.emergency?'Emergency flag enabled in the demo only.':'Emergency demo flag cleared.','info')}else{state.safeMode=!state.safeMode;persist(state.safeMode?'Safe Mode flag enabled in the demo only.':'Safe Mode demo flag cleared.','info')}render();return}
  const scheduleToggle=target.closest('[data-schedule-toggle]');if(scheduleToggle){const item=state.schedules.find(s=>s.id===scheduleToggle.dataset.scheduleToggle);if(item){item.status=item.status==='Active'?'Inactive':'Active';persist(`${item.name} is ${item.status.toLowerCase()} in the shared demo.`);render()}return}
  const scheduleEdit=target.closest('[data-schedule-edit]');if(scheduleEdit){openScheduleForm(scheduleEdit.dataset.scheduleEdit);return}
  const scheduleDelete=target.closest('[data-schedule-delete]');if(scheduleDelete){const item=state.schedules.find(s=>s.id===scheduleDelete.dataset.scheduleDelete);if(item&&window.confirm(`Delete “${item.name}” from the shared demo database for everyone using this app?`)){state.schedules=state.schedules.filter(s=>s.id!==item.id);persist('Schedule deleted from the shared demo database.');render()}return}
  const preset=target.closest('[data-report-preset]');if(preset){setReportPreset(preset.dataset.reportPreset);return}
  const heat=target.closest('[data-heat-room]');if(heat){showToast(`${heat.dataset.heatRoom}: synthetic occupancy probability example. Not a sensor reading.`,'info');return}
});

document.addEventListener('input',event=>{
  const target=event.target;
  if(target.id==='room-search'){roomSearch=target.value;const list=$('#room-table-wrap');if(list){const query=roomSearch.toLowerCase().trim();const rows=state.rooms.filter(room=>(!query||`${room.name} ${room.building} ${room.type}`.toLowerCase().includes(query))&&(roomFilter==='all'||(roomFilter==='flagged'&&roomIsFlagged(room,Number(state.params.threshold)))||(roomFilter==='vacant'&&!room.occupied)||(roomFilter==='occupied'&&room.occupied)));list.innerHTML=roomTable(rows);const next=$('#room-search');next?.focus();next?.setSelectionRange(roomSearch.length,roomSearch.length)}return}
  if(target.id==='device-search'){controlFilters.search=target.value;const start=target.selectionStart;const box=$('#device-grid-container');if(box){box.innerHTML=filteredDevices().map(deviceCard).join('')||'<div class="empty-state"><strong>No devices match the filters</strong><span>Change a filter or search term.</span></div>';const next=$('#device-search');if(next){next.focus();next.setSelectionRange(start,start)}}return}
  if(target.dataset.param){const key=target.dataset.param;state.params[key]=Number(target.value);const output=target.parentElement.querySelector('output');if(output)output.textContent=key==='threshold'?`${Number(target.value).toFixed(1)} kWh`:`${target.value}%`;clearTimeout(persistTimer);persistTimer=setTimeout(()=>persist(),250);return}
  if(target.id.startsWith('roi-'))updateRoi();
});

document.addEventListener('change',event=>{
  const target=event.target;
  if(target.id==='report-from'||target.id==='report-to'){state.reportPreset='Custom';state[target.id==='report-from'?'reportFrom':'reportTo']=target.value;persist();render();return}
  if(target.matches('[data-auto-schedule]')){state.autoSchedule=target.checked;persist(`Rule-based auto-schedule ${target.checked?'enabled':'paused'} in this demo.`,'info');render();return}
  if(target.dataset.param){clearTimeout(persistTimer);const key=target.dataset.param;state.params[key]=Number(target.value);persist();render();return}
  if(target.id.startsWith('roi-'))updateRoi();
});

document.addEventListener('submit',event=>{
  const form=event.target;
  if(form.id==='room-form'){
    event.preventDefault();const values=Object.fromEntries(new FormData(form).entries());const id=form.dataset.roomId;
    if(!values.name.trim()){showToast('Enter a room name.','info');return}
    const room=state.rooms.find(r=>r.id===id);
    if(room){Object.assign(room,{name:values.name.trim(),building:values.building.trim()||room.building,type:values.type,capacity:Number(values.capacity)||room.capacity,usageKwh:Number(values.usageKwh)||0,occupied:values.occupied==='true',scheduled:values.scheduled==='true'});persist('Room reading saved to the shared demo database.')}
    else{addRoom({...values,name:values.name.trim(),building:values.building.trim()},form.dataset.roomMode);persist('Room added to the shared demo database.')}
    closeModal();render();return;
  }
  if(form.id==='quick-room-form'){
    event.preventDefault();const values=Object.fromEntries(new FormData(form).entries());if(!values.name.trim())return;addRoom({...values,building:values.building||'Campus',usageKwh:0,occupied:'false',scheduled:'false'},'layout');persist('Room added to the campus graph.');render();return;
  }
  if(form.id==='schedule-form'){
    event.preventDefault();const values=Object.fromEntries(new FormData(form).entries());const id=form.dataset.scheduleId;const existing=state.schedules.find(s=>s.id===id);if(existing)Object.assign(existing,values);else state.schedules.push({id:`schedule-${Date.now()}`,...values});persist(existing?'Schedule updated in the shared demo database.':'Schedule added to the shared demo database.');closeModal();render();return;
  }
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&$('.modal-backdrop'))closeModal();
  if(event.key==='Escape'){$('.site-header')?.classList.remove('nav-open');$('[data-action="toggle-nav"]')?.setAttribute('aria-expanded','false')}
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-node-code]'))event.target.click();
});
function updateRoi(){const budget=Number($('#roi-budget')?.value)||0;const reduction=Number($('#roi-reduction')?.value)||0;const rooms=Number($('#roi-rooms')?.value)||0;const result=$('#roi-result');if(result)result.textContent=currency(budget*reduction/100);const roomInput=$('#roi-rooms');if(roomInput&&rooms>10000)roomInput.value='10000';}
window.addEventListener('popstate',()=>{const page=window.location.hash.slice(1);currentPage=pages[page]?page:'home';render()});
render();
loadSharedState();
