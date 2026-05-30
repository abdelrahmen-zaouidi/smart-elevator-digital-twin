import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload[0]) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded p-3 shadow-lg">
        <p className="text-xs text-gray-400">{payload[0].name}</p>
        <p className="text-sm font-mono text-cyan-400">{payload[0].value}</p>
      </div>
    );
  }
  return null;
};

export default function TelemetryPanel({ vibHistory, tempHistory, loadHistory, energyHistory }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Vibration Chart */}
      <ChartCard title="Vibration Analysis" icon="⚡" subtitle="Motor vibration trend (last 60s)">
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={vibHistory} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#888' }} />
            <YAxis tick={{ fontSize: 11, fill: '#888' }} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="v"
              stroke="#06b6d4"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Temperature Chart */}
      <ChartCard title="Motor Temperature" icon="🌡️" subtitle="Operating temperature (last 60s)">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={tempHistory} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
            <defs>
              <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#888' }} />
            <YAxis tick={{ fontSize: 11, fill: '#888' }} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="v"
              stroke="#f59e0b"
              fill="url(#tempGrad)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Load Chart */}
      <ChartCard title="Cabin Load" icon="⚖️" subtitle="Weight distribution (last 60s)">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={loadHistory} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
            <defs>
              <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#888' }} />
            <YAxis tick={{ fontSize: 11, fill: '#888' }} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="v"
              stroke="#10b981"
              fill="url(#loadGrad)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Energy Chart */}
      <ChartCard title="Energy Consumption" icon="⚡" subtitle="Daily consumption by hour">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={energyHistory} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
            <defs>
              <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
            <XAxis dataKey="h" tick={{ fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 11, fill: '#888' }} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="kwh"
              stroke="#8b5cf6"
              fill="url(#energyGrad)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
