import { Lightbulb, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';
import ChartCard from './ChartCard';

const AI_INSIGHTS = [
  { id: 1, severity: 'WARNING', msg: 'Motor vibration trending +18% over last 4h — bearing fatigue likely', eta: '~12h' },
  { id: 2, severity: 'INFO', msg: 'Load patterns suggest peak demand floor 3 between 08:00–09:30', eta: null },
  { id: 3, severity: 'CRITICAL', msg: 'Motor hours 1889h — service interval overdue by 89h', eta: 'Now' },
  { id: 4, severity: 'INFO', msg: 'Energy consumption 7.2% below baseline — routing optimization active', eta: null },
  { id: 5, severity: 'WARNING', msg: '3 unauthorized RFID attempts detected in last 6h — pattern anomaly', eta: 'Monitor' },
];

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'CRITICAL': return 'bg-red-900/30 border-red-700/50 text-red-400';
    case 'WARNING': return 'bg-yellow-900/30 border-yellow-700/50 text-yellow-400';
    default: return 'bg-blue-900/20 border-blue-700/50 text-blue-400';
  }
};

const getSeverityIcon = (severity) => {
  switch (severity) {
    case 'CRITICAL': return <AlertTriangle size={16} />;
    case 'WARNING': return <TrendingDown size={16} />;
    default: return <Lightbulb size={16} />;
  }
};

export default function AIInsightsPanel({ state }) {
  const health = state.attributes.system_health_index;
  const efficiency = state.attributes.energy_efficiency;
  const uptime = state.attributes.uptime_pct;

  return (
    <div className="space-y-6">
      {/* System Health Overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className={health >= 80 ? 'text-green-400' : health >= 50 ? 'text-yellow-400' : 'text-red-400'} />
            <span className="text-xs text-gray-500 uppercase tracking-wide">System Health</span>
          </div>
          <p className={`text-2xl font-bold ${health >= 80 ? 'text-green-400' : health >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
            {health}%
          </p>
          <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all rounded-full ${health >= 80 ? 'bg-green-500' : health >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${health}%` }}
            />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} className="text-purple-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Energy Efficiency</span>
          </div>
          <p className="text-2xl font-bold text-purple-400">{efficiency}%</p>
          <p className="text-xs text-gray-500 mt-2">
            {efficiency >= 90 ? 'Excellent' : efficiency >= 75 ? 'Good' : 'Below target'}
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={16} className="text-cyan-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Uptime</span>
          </div>
          <p className="text-2xl font-bold text-cyan-400">{uptime.toFixed(2)}%</p>
          <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
        </div>
      </div>

      {/* AI Insights */}
      <ChartCard title="AI Insights & Predictions" icon="🧠" subtitle="Machine learning analysis and recommendations">
        <div className="space-y-3">
          {AI_INSIGHTS.map((insight) => (
            <div
              key={insight.id}
              className={`p-4 rounded-lg border transition-all hover:shadow-lg cursor-pointer ${getSeverityColor(insight.severity)}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-1">{getSeverityIcon(insight.severity)}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-200 mb-2">{insight.msg}</p>
                  {insight.eta && (
                    <p className="text-xs font-mono text-gray-400">
                      ETA: <span className="font-bold text-gray-300">{insight.eta}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ChartCard>

      {/* Predictive Maintenance */}
      <ChartCard title="Predictive Maintenance" icon="🔧" subtitle="Component RUL and service schedules">
        <div className="space-y-3">
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono text-gray-300">Motor RUL</span>
              <span className="text-lg font-bold text-yellow-400">{state.features.predicted_failures.properties.motor_rul_hours}h</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-yellow-500 rounded-full" />
            </div>
            <p className="text-xs text-gray-500 mt-2">Remaining useful life</p>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono text-gray-300">Bearing Health</span>
              <span className="text-lg font-bold text-green-400">{state.features.predicted_failures.properties.bearing_health_pct}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full w-3/4 bg-green-500 rounded-full" />
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono text-gray-300">Door Mechanism</span>
              <span className="text-lg font-bold text-green-400">{state.features.predicted_failures.properties.door_mechanism_pct}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full w-5/6 bg-green-500 rounded-full" />
            </div>
          </div>

          <div className="bg-blue-900/30 rounded-lg p-3 border border-blue-700/50 mt-4">
            <p className="text-xs text-gray-400 mb-2">Next Service</p>
            <p className="text-sm font-mono text-blue-300 font-bold">
              {state.features.predicted_failures.properties.next_service_date}
            </p>
          </div>
        </div>
      </ChartCard>

      {/* Dispatch Optimization */}
      <ChartCard title="Dispatch Optimization" icon="📊" subtitle="AI recommendations for elevator coordination">
        <div className="space-y-2 text-sm text-gray-300">
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <p className="font-mono text-cyan-400">→</p>
            <p>Enable peak-hour load balancing algorithm</p>
            <p className="text-xs text-gray-500 mt-1">Expected improvement: 18%</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <p className="font-mono text-green-400">→</p>
            <p>Energy regeneration mode recommended for off-peak hours</p>
            <p className="text-xs text-gray-500 mt-1">Potential savings: 12% daily</p>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <p className="font-mono text-yellow-400">→</p>
            <p>Schedule preventive maintenance before peak season</p>
            <p className="text-xs text-gray-500 mt-1">Prevent 95% of failures</p>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
