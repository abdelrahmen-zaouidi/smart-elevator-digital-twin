/**
 * Shared reward function — the SINGLE definition of "a good decision".
 *
 * Used identically by (a) Brain B training (the optimisation target),
 * (b) the promotion evaluator (did the challenger earn more reward?), and
 * (c) the dashboard. Defining it once means the training target and the
 * evaluation metric can never drift apart.
 *
 *   reward = −w_wait·wait  − w_energy·energy  − w_stress·machine_stress
 *            + w_throughput·throughput  − w_fairness·fairness_penalty
 *
 * Any safety violation is a hard floor (−Infinity): a policy that caused an
 * unsafe state can never be rewarded, no matter how efficient it was.
 *
 * Inputs are realized KPIs over a decision's evaluation window (dispatch_outcome).
 * Pure and deterministic.
 */

export const DEFAULT_REWARD_WEIGHTS = Object.freeze({
  wait: 1.0,        // per minute of average wait
  energy: 1.0,      // per kWh over the window
  stress: 1.0,      // machine-stress proxy (0..~1)
  throughput: 0.5,  // per 10 trips
  fairness: 1.0,    // fairness penalty (0..~1)
});

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * computeReward(kpis, weights) -> { reward, terms, safe }
 *   kpis: { avg_wait_s, energy_kwh, machine_stress, trips, fairness_penalty, safety_violation }
 */
export function computeReward(kpis = {}, weights = DEFAULT_REWARD_WEIGHTS) {
  const w = { ...DEFAULT_REWARD_WEIGHTS, ...weights };
  if (kpis.safety_violation === true) {
    return { reward: -Infinity, terms: { safety: -Infinity }, safe: false };
  }
  const terms = {
    wait: -w.wait * (num(kpis.avg_wait_s) / 60),
    energy: -w.energy * num(kpis.energy_kwh),
    stress: -w.stress * num(kpis.machine_stress),
    throughput: w.throughput * (num(kpis.trips) / 10),
    fairness: -w.fairness * num(kpis.fairness_penalty),
  };
  let reward = 0;
  for (const k in terms) reward += terms[k];
  return { reward: +reward.toFixed(4), terms, safe: true };
}

/**
 * machineStressProxy — derive a 0..~1 stress score from raw telemetry so the
 * outcome store has a single, explainable stress definition.
 */
export function machineStressProxy({ motor_temp_c = 25, vibration = 0, duty_fraction = 0 } = {}) {
  const thermal = Math.min(1, Math.max(0, (motor_temp_c - 55) / 40));   // 55→0, 95→1
  const vib = Math.min(1, Math.max(0, vibration / 0.5));
  const duty = Math.min(1, Math.max(0, duty_fraction));
  return +(0.45 * thermal + 0.4 * vib + 0.15 * duty).toFixed(4);
}
