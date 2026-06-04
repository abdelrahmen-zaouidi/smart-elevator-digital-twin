const row = $input.first().json || {};
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const thingId = row.thing_id || $env.PRIMARY_THING_ID || 'building:floor1:elevator';
const currentFloor = num(row.current_floor);
const baselinePower = num(row.baseline_power_kw);
const baselineCurrent = num(row.baseline_current_a);
const baselineVibration = num(row.baseline_vibration_g);
const currentPower = num(row.current_power_kw ?? row.power_kw);
const currentCurrent = num(row.current_draw_a);
const currentVibration = num(row.current_vibration_g ?? row.vibration_g);
const loadKg = num(row.load_kg);
const demandFloor = Number.isFinite(Number(row.predicted_demand_floor)) ? Number(row.predicted_demand_floor) : currentFloor;

const recommendations = [];
if (baselinePower > 0 && currentPower > baselinePower * 1.25) recommendations.push('POWER_SPIKE');
if (baselineCurrent > 0 && currentCurrent > baselineCurrent * 1.25) recommendations.push('CURRENT_DRAW_ELEVATED');
if (baselineVibration > 0 && currentVibration > baselineVibration * 1.5) recommendations.push('VIBRATION_ELEVATED');
if (loadKg < 50 && baselinePower > 0 && currentPower > baselinePower * 1.2) recommendations.push('HIGH_CONSUMPTION_LOW_LOAD');

let energyMode = 'NORMAL';
if (recommendations.includes('HIGH_CONSUMPTION_LOW_LOAD') || row.direction === 'IDLE') energyMode = 'SAVING';
if (Number(row.samples || 0) >= 10 && loadKg > 200) energyMode = 'PEAK';

const maintenanceLinked = recommendations.some((item) => ['VIBRATION_ELEVATED', 'CURRENT_DRAW_ELEVATED'].includes(item));
const confidence = Math.min(1, Math.max(0.2, Number(row.samples || 0) / 20));

return [{
  json: {
    ...row,
    thing_id: thingId,
    should_notify: recommendations.length > 0,
    should_open_maintenance_review: maintenanceLinked,
    optimization: {
      recommended_parking_floor: demandFloor,
      predicted_demand_floor: demandFloor,
      energy_mode: energyMode,
      confidence: Math.round(confidence * 100) / 100,
      recommendations,
      updated_at: new Date().toISOString()
    },
    risk_analysis: {
      severity: recommendations.length > 0 ? 'WARNING' : 'OK',
      risk_score: recommendations.length > 0 ? 45 : 0,
      flags: recommendations
    }
  }
}];

