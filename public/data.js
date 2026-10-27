export const ALERT_THRESHOLD_KWH = 0.8;
export const HIGH_PRIORITY_THRESHOLD_KWH = 2.0;
export const SAMPLE_RATE_PER_KWH = 8.5;

export const DEFAULT_ROOMS = [
  { id: 'room-101', code: 'ENG', name: 'Lecture Hall 01', building: 'Academic Block A', buildingCode: 'A', type: 'Classroom', capacity: 60, usageKwh: 2.4, occupied: false, scheduled: false, graphX: 410, graphY: 70 },
  { id: 'room-102', code: 'SCI', name: 'Computer Lab B', building: 'Technology Wing', buildingCode: 'B', type: 'Laboratory', capacity: 35, usageKwh: 1.7, occupied: false, scheduled: true, graphX: 475, graphY: 185 },
  { id: 'room-103', code: 'LIB', name: 'Library Commons', building: 'Learning Centre', buildingCode: 'A', type: 'Library', capacity: 120, usageKwh: 3.6, occupied: true, scheduled: true, graphX: 300, graphY: 240 },
  { id: 'room-104', code: 'ADM', name: 'Chemistry Lab 2', building: 'Science Block', buildingCode: 'C', type: 'Laboratory', capacity: 28, usageKwh: 2.1, occupied: false, scheduled: false, graphX: 420, graphY: 340 },
  { id: 'room-105', code: 'CL1', name: 'Seminar Room 3', building: 'Academic Block B', buildingCode: 'B', type: 'Classroom', capacity: 42, usageKwh: 0.5, occupied: false, scheduled: false, graphX: 360, graphY: 470 },
  { id: 'room-106', code: 'CL2', name: 'Faculty Lounge', building: 'Academic Block A', buildingCode: 'A', type: 'Office', capacity: 18, usageKwh: 1.2, occupied: true, scheduled: false, graphX: 470, graphY: 580 },
  { id: 'room-107', code: 'AUD', name: 'Design Studio', building: 'Arts Annex', buildingCode: 'D', type: 'Auditorium', capacity: 95, usageKwh: 1.4, occupied: false, scheduled: false, graphX: 595, graphY: 350 },
  { id: 'room-108', code: 'CL3', name: 'Admin Office', building: 'Administration', buildingCode: 'C', type: 'Office', capacity: 24, usageKwh: 1.8, occupied: true, scheduled: true, graphX: 610, graphY: 515 }
];

export const DEFAULT_PATHWAYS = [
  { id: 'edge-1', from: 'ENG', to: 'SCI', distance: 75 },
  { id: 'edge-2', from: 'SCI', to: 'ADM', distance: 45 },
  { id: 'edge-3', from: 'LIB', to: 'ADM', distance: 60 },
  { id: 'edge-4', from: 'SCI', to: 'LIB', distance: 80 },
  { id: 'edge-5', from: 'ADM', to: 'CL1', distance: 55 },
  { id: 'edge-6', from: 'ADM', to: 'AUD', distance: 85 },
  { id: 'edge-7', from: 'CL1', to: 'CL2', distance: 65 },
  { id: 'edge-8', from: 'AUD', to: 'CL3', distance: 70 },
  { id: 'edge-9', from: 'CL2', to: 'CL3', distance: 90 }
];

const deviceSeed = [
  ['Light #1','Light','Library','A101','A','Library',110,120,15],
  ['AC #2','AC','Classroom A1','A102','A','Classroom',220,1500,120],
  ['Fan #3','Fan','Lab B2','B201','B','Laboratory',110,75,8],
  ['Computer #4','Computer','Office C3','C301','C','Office',110,200,25],
  ['Projector #5','Projector','Auditorium','A201','A','Auditorium',220,300,18],
  ['Light #6','Light','Hallway D4','D401','D','Hallway',110,100,12],
  ['AC #7','AC','Library','A101','A','Library',220,1800,150],
  ['Computer #8','Computer','Lab B2','B201','B','Laboratory',110,180,22],
  ['Light #9','Light','Classroom A2','A103','A','Classroom',110,80,11],
  ['Fan #10','Fan','Office C4','C302','C','Office',110,80,9],
  ['Projector #11','Projector','Classroom A1','A102','A','Classroom',220,250,15],
  ['AC #12','AC','Auditorium','A201','A','Auditorium',220,2000,175],
  ['Printer #13','Printer','Admin Office','C105','C','Office',110,400,28],
  ['Light #14','Light','Science Lab','C204','C','Laboratory',110,90,10],
  ['Computer #15','Computer','Design Studio','D105','D','Studio',110,220,24],
  ['Fan #16','Fan','Lecture Hall 01','B105','B','Classroom',110,70,8],
  ['AC #17','AC','Computer Lab B','B201','B','Laboratory',220,1600,132],
  ['Projector #18','Projector','Seminar Room 3','B102','B','Classroom',110,220,14],
  ['Light #19','Light','Library Commons','A101','A','Library',110,110,13],
  ['Computer #20','Computer','Faculty Lounge','A107','A','Office',110,180,18],
  ['AC #21','AC','Lecture Hall 01','B105','B','Classroom',220,1700,142],
  ['Fan #22','Fan','Design Studio','D105','D','Studio',110,65,7],
  ['Light #23','Light','Chemistry Lab 2','C204','C','Laboratory',110,95,10],
  ['Projector #24','Projector','Auditorium','A201','A','Auditorium',220,280,17],
  ['Computer #25','Computer','Admin Office','C105','C','Office',110,210,21],
  ['AC #26','AC','Faculty Lounge','A107','A','Office',220,900,70],
  ['Light #27','Light','Computer Lab B','B201','B','Laboratory',110,90,9],
  ['Fan #28','Fan','Lecture Hall 01','B105','B','Classroom',110,80,8],
  ['Computer #29','Computer','Seminar Room 3','B102','B','Classroom',110,190,20],
  ['Projector #30','Projector','Library Commons','A101','A','Library',220,260,16]
];

export const DEFAULT_DEVICES = deviceSeed.map((item, index) => ({
  id: `device-${index + 1}`,
  name: item[0], type: item[1], location: item[2], room: item[3], buildingCode: item[4], roomType: item[5], voltage: item[6], powerW: item[7], savedKwh: item[8],
  status: index < 20 ? 'online' : index < 26 ? 'offline' : 'issue',
  on: index < 20 ? index % 7 !== 2 : index >= 26 && index % 2 === 0,
  simulated: true
}));

export const DEFAULT_SCHEDULES = [
  { id: 'schedule-1', name: 'Morning classes', target: 'Classrooms · Buildings A–B', trigger: 'Weekdays · 7:30 AM', action: 'Power up lights and AV before first class', status: 'Active' },
  { id: 'schedule-2', name: 'Evening shutdown', target: 'Common areas · all buildings', trigger: 'Daily · 8:30 PM', action: 'Check occupancy, then dim lights and HVAC', status: 'Active' },
  { id: 'schedule-3', name: 'Laboratory safety', target: 'Laboratories', trigger: 'No occupancy · 30 min', action: 'Prompt operator to review high-load equipment', status: 'Active' }
];

export function createDefaultState() {
  return {
    rooms: structuredClone(DEFAULT_ROOMS), pathways: structuredClone(DEFAULT_PATHWAYS), devices: structuredClone(DEFAULT_DEVICES), schedules: structuredClone(DEFAULT_SCHEDULES), reviewed: [],
    dashboardRange: 'Today', analyticsRange: 'Week', reportPreset: 'Last 7 Days', reportFrom: '', reportTo: '',
    params: { recurrence: 68, threshold: ALERT_THRESHOLD_KWH, probability: 72 }, autoSchedule: true, safeMode: false, emergency: false
  };
}

export function roomIsFlagged(room, threshold = ALERT_THRESHOLD_KWH) {
  return !room.occupied && !room.scheduled && Number(room.usageKwh) > Number(threshold);
}

export function getRoomAlerts(rooms, threshold = ALERT_THRESHOLD_KWH) {
  return rooms.filter(room => roomIsFlagged(room, threshold)).map(room => ({
    room,
    severity: Number(room.usageKwh) >= HIGH_PRIORITY_THRESHOLD_KWH ? 'High' : 'Medium',
    reason: `${Number(room.usageKwh).toFixed(1)} kWh in the last 60 minutes; vacant and not scheduled.`,
    recommendation: 'Check lights and HVAC; switch off equipment that is not needed.'
  })).sort((a,b) => Number(b.room.usageKwh) - Number(a.room.usageKwh));
}

function seeded(index, shift = 0) {
  const raw = Math.sin((index + 1) * 127.1 + shift * 311.7) * 43758.5453;
  return raw - Math.floor(raw);
}

export function makeTrend(range = 'Today', size = null) {
  const lengths = { Today: 12, Week: 7, Month: 12, Year: 12 };
  const counts = size || lengths[range] || 12;
  const labels = range === 'Today' ? ['6 AM','8 AM','10 AM','12 PM','2 PM','4 PM','6 PM','8 PM','10 PM','12 AM','2 AM','4 AM']
    : range === 'Week' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    : range === 'Month' ? ['Wk 1','Wk 2','Wk 3','Wk 4','Wk 5','Wk 6','Wk 7','Wk 8','Wk 9','Wk 10','Wk 11','Wk 12']
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const baseline = range === 'Today' ? 100 : range === 'Week' ? 1060 : range === 'Month' ? 7800 : 15000;
  const actual = Array.from({ length: counts }, (_, i) => Math.round(baseline * (0.63 + seeded(i, range.length) * 0.45) * (i > counts * 0.7 ? 0.94 : 1)));
  const target = actual.map((value, i) => Math.round(value * (0.82 + 0.025 * Math.sin(i * 0.7))));
  return { labels: labels.slice(0, counts), actual, target };
}

export function makeForecast(params = {}) {
  const history = makeTrend('Month', 12).actual;
  const weight = Math.max(0.1, Math.min(0.95, Number(params.recurrence || 68) / 100));
  let previous = history.slice(-3).reduce((sum, value) => sum + value, 0) / 3;
  const forecast = [];
  for (let i = 0; i < 30; i++) {
    const seasonal = 1 + 0.07 * Math.sin(i / 4) - 0.035 * Math.cos(i / 2.4);
    const expected = previous * (0.985 + (1 - weight) * 0.03) * seasonal;
    previous = expected;
    forecast.push(Math.round(expected));
  }
  return { history, forecast, lower: forecast.map(value => Math.round(value * 0.88)), upper: forecast.map(value => Math.round(value * 1.12)) };
}

export function makeReportRows(days = 30) {
  const rows = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const energy = Math.round(720 + seeded(i, 22) * 980 + 120 * Math.sin(i / 2.6));
    const savings = Math.round(62 + seeded(i, 91) * 185);
    const co2 = Math.round(energy * 0.49);
    const efficiency = Math.round(72 + seeded(i, 11) * 25);
    rows.push({ date, label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date), energy, savings, co2, efficiency });
  }
  return rows;
}

export function calculateMST(rooms, pathways) {
  const parent = new Map(rooms.map(room => [room.code, room.code]));
  const find = item => {
    let root = item;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(item) !== item) { const next = parent.get(item); parent.set(item, root); item = next; }
    return root;
  };
  const chosen = [];
  let total = 0;
  for (const edge of [...pathways].filter(edge => parent.has(edge.from) && parent.has(edge.to)).sort((a,b) => Number(a.distance)-Number(b.distance))) {
    const a = find(edge.from), b = find(edge.to);
    if (a === b) continue;
    parent.set(a,b); chosen.push(edge); total += Number(edge.distance);
  }
  return { edges: chosen, total, connected: new Set([...parent.keys()].map(find)).size <= 1 };
}

export function calculateShortestPath(rooms, pathways, start, finish) {
  const codes = rooms.map(room => room.code);
  if (!codes.includes(start) || !codes.includes(finish)) return { path: [], distance: Infinity };
  const distances = new Map(codes.map(code => [code, Infinity]));
  const previous = new Map();
  const remaining = new Set(codes);
  distances.set(start, 0);
  while (remaining.size) {
    let current = null;
    for (const code of remaining) if (current === null || distances.get(code) < distances.get(current)) current = code;
    if (current === null || !Number.isFinite(distances.get(current)) || current === finish) break;
    remaining.delete(current);
    for (const edge of pathways) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next || !remaining.has(next)) continue;
      const candidate = distances.get(current) + Number(edge.distance);
      if (candidate < distances.get(next)) { distances.set(next, candidate); previous.set(next, current); }
    }
  }
  if (!Number.isFinite(distances.get(finish))) return { path: [], distance: Infinity };
  const path = [finish];
  while (path[0] !== start) {
    const next = previous.get(path[0]);
    if (!next) return { path: [], distance: Infinity };
    path.unshift(next);
  }
  return { path, distance: distances.get(finish) };
}

export function optimizeSensorPlacement(rooms, pathways) {
  const neighbors = new Map(rooms.map(room => [room.code, new Set([room.code])]));
  for (const edge of pathways) {
    if (!neighbors.has(edge.from) || !neighbors.has(edge.to)) continue;
    neighbors.get(edge.from).add(edge.to);
    neighbors.get(edge.to).add(edge.from);
  }
  const uncovered = new Set(rooms.map(room => room.code));
  const selected = [];
  while (uncovered.size) {
    let best = null;
    let bestCover = [];
    for (const [candidate, coverSet] of neighbors) {
      const cover = [...coverSet].filter(code => uncovered.has(code));
      if (cover.length > bestCover.length) { best = candidate; bestCover = cover; }
    }
    if (!best || !bestCover.length) {
      const next = uncovered.values().next().value;
      best = next;
      bestCover = [next];
    }
    selected.push({ room: best, covers: bestCover });
    bestCover.forEach(code => uncovered.delete(code));
  }
  return selected;
}
