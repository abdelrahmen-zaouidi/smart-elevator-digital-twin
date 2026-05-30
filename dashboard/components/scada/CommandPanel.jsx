import { AlertTriangle, Zap, Lock, Wrench, RefreshCw } from 'lucide-react';
import ChartCard from './ChartCard';

const FLOOR_LABELS = ['0', '1', '2', '3'];
const SCENARIOS = [
  { key: 'motor_failure', label: 'Motor Failure', color: 'text-red-400', bgColor: 'bg-red-900/30 border-red-700' },
  { key: 'overload', label: 'Overload', color: 'text-yellow-400', bgColor: 'bg-yellow-900/30 border-yellow-700' },
  { key: 'security_breach', label: 'Security Breach', color: 'text-red-400', bgColor: 'bg-red-900/30 border-red-700' },
  { key: 'fire_emergency', label: 'Fire Emergency', color: 'text-red-600', bgColor: 'bg-red-900/50 border-red-600' },
  { key: 'peak_traffic', label: 'Peak Traffic', color: 'text-blue-400', bgColor: 'bg-blue-900/30 border-blue-700' },
];

const CommandButton = ({ icon: Icon, label, onClick, variant = 'default', disabled = false }) => {
  const baseClass = 'flex-1 flex flex-col items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-gray-100 border border-gray-700 hover:border-gray-600',
    danger: 'bg-red-900/40 hover:bg-red-900/60 text-red-400 hover:text-red-300 border border-red-700 hover:border-red-600',
    warning: 'bg-yellow-900/40 hover:bg-yellow-900/60 text-yellow-400 hover:text-yellow-300 border border-yellow-700 hover:border-yellow-600',
    safe: 'bg-green-900/40 hover:bg-green-900/60 text-green-400 hover:text-green-300 border border-green-700 hover:border-green-600',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${variants[variant]}`}
      title={label}
    >
      {Icon && <Icon size={18} />}
      <span className="text-xs">{label}</span>
    </button>
  );
};

export default function CommandPanel({ state, commands }) {
  const mode = state.attributes.system_mode;
  const inLockdown = mode === 'LOCKDOWN';
  const inMaintenance = mode === 'MAINTENANCE';

  return (
    <div className="space-y-6">
      {/* System Commands */}
      <ChartCard title="System Commands" icon="⚙" subtitle="Critical control operations">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CommandButton
            icon={Zap}
            label="Emergency Stop"
            variant="danger"
            onClick={commands.emergencyStop}
            disabled={inLockdown}
          />
          <CommandButton
            icon={Lock}
            label="Lockdown"
            variant="danger"
            onClick={commands.lockdown}
            disabled={inLockdown}
          />
          <CommandButton
            icon={Wrench}
            label="Maintenance"
            variant="warning"
            onClick={commands.maintenance}
            disabled={inMaintenance}
          />
          <CommandButton
            icon={RefreshCw}
            label="Reset System"
            variant="safe"
            onClick={commands.reset}
          />
        </div>
      </ChartCard>

      {/* Floor Control */}
      <ChartCard title="Floor Commands" icon="⬡" subtitle="Send elevator to floor">
        <div className="grid grid-cols-4 gap-2">
          {FLOOR_LABELS.map((label, idx) => (
            <button
              key={idx}
              onClick={() => commands.sendFloor(idx)}
              className={`py-2 rounded-lg font-bold text-sm transition-all border ${
                state.features.cabin.properties.current_floor === idx
                  ? 'bg-cyan-600 border-cyan-500 text-white shadow-lg shadow-cyan-500/50'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </ChartCard>

      {/* Optimization Commands */}
      <ChartCard title="Optimization Controls" icon="📊" subtitle="Elevator dispatch and energy strategies">
        <div className="grid grid-cols-2 gap-3">
          <CommandButton
            label="Optimize Routing"
            onClick={commands.optimizeRouting}
          />
          <CommandButton
            label="Reduce Energy"
            onClick={commands.reduceEnergy}
          />
        </div>
      </ChartCard>

      {/* Scenario Injection */}
      <ChartCard title="Simulation Scenarios" icon="⚡" subtitle="Inject failure scenarios for testing">
        <div className="space-y-2">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.key}
              onClick={() => commands.runScenario(scenario.key)}
              className={`w-full px-4 py-3 rounded-lg border text-left transition-all hover:shadow-lg ${scenario.bgColor}`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} />
                <div>
                  <p className={`text-sm font-bold ${scenario.color}`}>{scenario.label}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ChartCard>

      {/* Anomaly Injection */}
      <ChartCard title="Anomaly Injectors" icon="🧪" subtitle="Test system resilience">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={commands.injectHighVib}
            className="px-3 py-2 text-xs font-mono bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700 rounded-lg text-yellow-400 transition-colors"
          >
            Inject High Vibration
          </button>
          <button
            onClick={commands.injectForcedEntry}
            className="px-3 py-2 text-xs font-mono bg-red-900/30 hover:bg-red-900/50 border border-red-700 rounded-lg text-red-400 transition-colors"
          >
            Inject Forced Entry
          </button>
          <button
            onClick={commands.injectAudioDistress}
            className="px-3 py-2 text-xs font-mono bg-red-900/30 hover:bg-red-900/50 border border-red-700 rounded-lg text-red-400 transition-colors"
          >
            Inject Audio Distress
          </button>
          <button
            onClick={commands.injectInvalidRFID}
            className="px-3 py-2 text-xs font-mono bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-700 rounded-lg text-yellow-400 transition-colors"
          >
            Inject Invalid RFID
          </button>
        </div>
      </ChartCard>
    </div>
  );
}
