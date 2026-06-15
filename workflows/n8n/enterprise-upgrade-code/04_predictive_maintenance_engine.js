const rawInput = $input.first().json || {};
const input = (rawInput.body && typeof rawInput.body === 'object' && rawInput.body.thing_id) ? rawInput.body : rawInput;
const payload = input.payload || {};
const motor = payload.motor || {};
const door = payload.door || {};
const cabin = payload.cabin || {};
const energy = payload.energy || {};
const flags = input.risk_analysis?.flags || [];

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const thingId = input.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator';
const now = new Date();
const vibRatio = num(motor.vibration_g) / Math.max(num(motor.vibration_baseline_g, 0.05), 0.001);
const hoursFactor = clamp(num(motor.hours_operated) / 10000, 0, 1);
const loadFactor = clamp(num(cabin.load_kg) / Math.max(num(cabin.max_load_kg, 800), 1), 0, 1.5);
const tempFactor = clamp((num(motor.temperature_c) - 55) / 45, 0, 1);
const currentFactor = clamp(num(motor.current_draw_a) / 45, 0, 1);
const powerFactor = clamp(num(motor.power_kw) / 12, 0, 1);
const doorFactor = clamp(num(door.cycle_count) / 30000, 0, 1);
const forcedStopFactor = flags.filter((flag) => ['EMERGENCY_STOP_ACTIVE', 'STUCK_BETWEEN_FLOORS'].includes(flag)).length > 0 ? 1 : 0;
const energyFactor = Array.isArray(energy.recommendations) && energy.recommendations.length > 0 ? 1 : 0;

const wearIndex = clamp(
  (hoursFactor * 22) +
  (loadFactor * 10) +
  (clamp(vibRatio / 4, 0, 1) * 28) +
  (tempFactor * 14) +
  (currentFactor * 10) +
  (powerFactor * 7) +
  (doorFactor * 6) +
  (forcedStopFactor * 8) +
  (energyFactor * 5),
  0,
  100
);

let priority = 'LOW';
let estimatedFailureDays = 120;
const tasks = [];
const issueReasons = [];

if (wearIndex >= 85 || vibRatio >= 4 || num(motor.temperature_c) >= 90) {
  priority = 'CRITICAL';
  estimatedFailureDays = 3;
  tasks.push({ task: 'Immediate motor, brake, and bearing inspection', urgency: 'IMMEDIATE', estimated_hours: 6 });
  issueReasons.push('critical_wear');
} else if (wearIndex >= 70 || vibRatio >= 3 || num(motor.temperature_c) >= 80) {
  priority = 'HIGH';
  estimatedFailureDays = 10;
  tasks.push({ task: 'Motor thermal inspection', urgency: 'HIGH', estimated_hours: 3 });
  tasks.push({ task: 'Vibration and bearing diagnostics', urgency: 'HIGH', estimated_hours: 3 });
  issueReasons.push('high_wear');
} else if (wearIndex >= 50 || vibRatio >= 2.2 || flags.includes('HIGH_CURRENT_DRAW')) {
  priority = 'MEDIUM';
  estimatedFailureDays = 30;
  tasks.push({ task: 'Planned vibration trend review', urgency: 'PLANNED', estimated_hours: 2 });
  tasks.push({ task: 'Current draw and power baseline check', urgency: 'PLANNED', estimated_hours: 2 });
  issueReasons.push('degradation_trend');
} else {
  tasks.push({ task: 'Routine inspection', urgency: 'ROUTINE', estimated_hours: 1 });
  issueReasons.push('routine');
}

const issueKey = issueReasons.join('+');
const workOrderId = `WO-${thingId.replace(/[^a-zA-Z0-9]/g, '-')}-${issueKey}-${now.getTime()}`;
const nextServiceDate = new Date(now);
nextServiceDate.setDate(nextServiceDate.getDate() + clamp(estimatedFailureDays - 2, 1, 45));

return [{
  json: {
    ...input,
    work_order: {
      work_order_id: workOrderId,
      correlation_id: input.correlation_id,
      thing_id: thingId,
      issue_key: issueKey,
      priority,
      wear_index: Math.round(wearIndex * 100) / 100,
      estimated_failure_days: estimatedFailureDays,
      tasks,
      evidence: {
        vibration_ratio: Math.round(vibRatio * 100) / 100,
        motor_temperature_c: num(motor.temperature_c),
        hours_operated: num(motor.hours_operated),
        current_draw_a: num(motor.current_draw_a),
        power_kw: num(motor.power_kw),
        door_cycle_count: num(door.cycle_count),
        flags,
        energy_recommendations: energy.recommendations || []
      },
      status: 'OPEN',
      notify_required: ['MEDIUM', 'HIGH', 'CRITICAL'].includes(priority),
      next_service_date: nextServiceDate.toISOString().slice(0, 10),
      generated_at: now.toISOString()
    }
  }
}];

