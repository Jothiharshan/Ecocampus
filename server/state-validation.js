const ROOM_TYPES = new Set(['Classroom', 'Laboratory', 'Office', 'Library', 'Auditorium', 'Hallway', 'Studio', 'Common area']);
const DEVICE_TYPES = new Set(['Light', 'AC', 'Computer', 'Projector', 'Fan', 'Printer']);
const DEVICE_STATUSES = new Set(['online', 'offline', 'issue']);
const SCHEDULE_STATUSES = new Set(['Active', 'Inactive']);

function isText(value, max, optional = false) {
  return (optional && value === '') || (typeof value === 'string' && value.trim().length > 0 && value.length <= max);
}
function isNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function isUnique(values) { return new Set(values).size === values.length; }

export function validateSharedState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'State must be a JSON object.';
  const limits = { rooms: 200, pathways: 2000, devices: 500, schedules: 300, reviewed: 200 };
  for (const [name, max] of Object.entries(limits)) {
    if (!Array.isArray(state[name]) || state[name].length > max) return `The ${name} list is missing or exceeds its ${max}-item limit.`;
  }

  const roomIds = [];
  const roomCodes = [];
  for (const [index, room] of state.rooms.entries()) {
    if (!room || typeof room !== 'object' ||
      !isText(room.id, 80) || !isText(room.code, 8) || !/^[A-Z0-9]+$/.test(room.code) ||
      !isText(room.name, 70) || !isText(room.building, 90) || !isText(room.type, 40) || !ROOM_TYPES.has(room.type) ||
      !isNumber(room.capacity, 1, 5000) || !isNumber(room.usageKwh, 0, 100000) ||
      typeof room.occupied !== 'boolean' || typeof room.scheduled !== 'boolean' ||
      (room.buildingCode != null && !isText(room.buildingCode, 12)) ||
      (room.graphX != null && !isNumber(room.graphX, 0, 10000)) ||
      (room.graphY != null && !isNumber(room.graphY, 0, 10000))) {
      return `Room ${index + 1} has invalid or unsupported fields.`;
    }
    roomIds.push(room.id);
    roomCodes.push(room.code);
  }
  if (!isUnique(roomIds) || !isUnique(roomCodes)) return 'Room IDs and room codes must be unique.';

  const edgeIds = [];
  for (const [index, edge] of state.pathways.entries()) {
    if (!edge || typeof edge !== 'object' || !isText(edge.id, 100) ||
      !roomCodes.includes(edge.from) || !roomCodes.includes(edge.to) || edge.from === edge.to ||
      !isNumber(edge.distance, 1, 100000)) return `Pathway ${index + 1} is invalid.`;
    edgeIds.push(edge.id);
  }
  if (!isUnique(edgeIds)) return 'Pathway IDs must be unique.';

  const deviceIds = [];
  for (const [index, device] of state.devices.entries()) {
    if (!device || typeof device !== 'object' || !isText(device.id, 100) || !isText(device.name, 100) ||
      !isText(device.type, 40) || !DEVICE_TYPES.has(device.type) || !isText(device.room, 32) ||
      !isText(device.roomType, 40) || !ROOM_TYPES.has(device.roomType) || !isText(device.location, 100) ||
      !isText(device.buildingCode, 12) || !isNumber(device.voltage, 1, 1000) ||
      !isNumber(device.powerW, 0, 100000) || !isNumber(device.savedKwh, 0, 1000000) ||
      !DEVICE_STATUSES.has(device.status) || typeof device.on !== 'boolean' || device.simulated !== true) {
      return `Device ${index + 1} is invalid; metadata must be safe, bounded sample values.`;
    }
    deviceIds.push(device.id);
  }
  if (!isUnique(deviceIds)) return 'Device IDs must be unique.';

  const scheduleIds = [];
  for (const [index, schedule] of state.schedules.entries()) {
    if (!schedule || typeof schedule !== 'object' || !isText(schedule.id, 100) ||
      !isText(schedule.name, 90) || !isText(schedule.target, 120) || !isText(schedule.trigger, 120) ||
      !isText(schedule.action, 240) || !SCHEDULE_STATUSES.has(schedule.status)) return `Schedule ${index + 1} is invalid.`;
    scheduleIds.push(schedule.id);
  }
  if (!isUnique(scheduleIds)) return 'Schedule IDs must be unique.';
  if (!state.reviewed.every(id => isText(id, 80)) || !isUnique(state.reviewed)) return 'Reviewed alert IDs must be unique strings.';

  if (!['Today', 'Week', 'Month', 'Year'].includes(state.dashboardRange) ||
      !['Week', 'Month', 'Year'].includes(state.analyticsRange) ||
      !isText(state.reportPreset, 40) ||
      !isText(state.reportFrom, 10, true) || !isText(state.reportTo, 10, true) ||
      (state.reportFrom && !/^\d{4}-\d{2}-\d{2}$/.test(state.reportFrom)) ||
      (state.reportTo && !/^\d{4}-\d{2}-\d{2}$/.test(state.reportTo))) return 'A dashboard/report selection is invalid.';

  if (!state.params || typeof state.params !== 'object' ||
      !isNumber(state.params.recurrence, 10, 95) || !isNumber(state.params.threshold, 0.1, 50) ||
      !isNumber(state.params.probability, 30, 95)) return 'Analysis parameters are invalid.';
  for (const key of ['autoSchedule', 'safeMode', 'emergency']) {
    if (typeof state[key] !== 'boolean') return `The ${key} setting must be a boolean.`;
  }
  const size = Buffer.byteLength(JSON.stringify(state), 'utf8');
  if (size > 900_000) return 'The state document exceeds the supported size.';
  return null;
}
