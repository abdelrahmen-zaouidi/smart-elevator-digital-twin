import ChartCard from './ChartCard';
import { Zap, Thermometer, Radio } from 'lucide-react';

const FLOOR_LABELS = ['0', '1', '2', '3'];
const MAX_FLOOR_INDEX = FLOOR_LABELS.length - 1;
const clampFloor = (value) => {
  const floor = Math.round(Number(value));
  return Number.isFinite(floor) ? Math.max(0, Math.min(MAX_FLOOR_INDEX, floor)) : 0;
};

export default function DigitalTwinPanel({ state }) {
  const cabin = state.features.cabin.properties;
  const motor = state.features.motor.properties;
  const door = state.features.door.properties;
  const currentFloor = clampFloor(cabin.current_floor);
  const targetFloor = clampFloor(cabin.target_floor);

  const healthColor = motor.health_status === 'CRITICAL' ? 'text-red-400 bg-red-900/30' :
                     motor.health_status === 'WARNING' ? 'text-yellow-400 bg-yellow-900/30' :
                     'text-green-400 bg-green-900/30';

  return (
    <div className="space-y-6">
      {/* Main Twin Visualization */}
      <ChartCard title="Elevator Twin" icon="⬡" subtitle="Real-time 3D digital twin">
        <div className="grid grid-cols-3 gap-4 h-full">
          {/* Shaft Visualization */}
          <div className="col-span-2 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="flex flex-col h-96 justify-between relative">
              {/* Floor Indicators */}
              <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between items-center text-xs text-gray-500 font-mono">
                {FLOOR_LABELS.map((label, i) => (
                  <span key={i} className={currentFloor === i ? 'text-cyan-400 font-bold' : ''}>
                    {label}
                  </span>
                ))}
              </div>

              {/* Shaft Background */}
              <div className="flex-1 ml-12 bg-gradient-to-b from-gray-800 to-gray-900 rounded-lg border border-gray-700 relative overflow-hidden">
                {/* Cabin */}
                <div
                  className="absolute left-4 right-4 h-16 bg-gradient-to-b from-blue-700 to-blue-900 border-2 border-blue-500 rounded-lg transition-all duration-500 shadow-lg flex items-center justify-center flex-col gap-1"
                  style={{ top: `${(currentFloor / MAX_FLOOR_INDEX) * 100}%` }}
                >
                  <div className="text-xs font-mono text-blue-200">
                    {cabin.direction === 'UP' ? '↑' : cabin.direction === 'DOWN' ? '↓' : '—'}
                  </div>
                  <div className="text-xs font-bold text-blue-100">
                    {cabin.speed_ms.toFixed(1)} m/s
                  </div>
                </div>

                {/* Load Bar */}
                <div className="absolute top-2 right-2 w-6 bg-gray-700 rounded-full h-24 flex flex-col-reverse border border-gray-600">
                  <div
                    className="bg-gradient-to-t from-green-500 to-cyan-400 rounded-full transition-all duration-300 ease-out"
                    style={{ height: `${(cabin.load_kg / 800) * 100}%` }}
                  />
                </div>
              </div>

              {/* Target Floor */}
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-500">Target Floor</p>
                <p className="text-2xl font-bold text-cyan-400">{FLOOR_LABELS[targetFloor]}</p>
              </div>
            </div>
          </div>

          {/* Stats Panel */}
          <div className="space-y-3 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Current</p>
              <p className="text-2xl font-bold text-gray-100">{FLOOR_LABELS[currentFloor]}</p>
            </div>

            <div className={`p-3 rounded-lg ${healthColor}`}>
              <p className="text-xs font-mono uppercase">Motor Health</p>
              <p className="text-lg font-bold">{motor.health_status}</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Temperature</span>
                <span className="text-cyan-400 font-mono">{motor.temperature_c.toFixed(1)}°C</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Vibration</span>
                <span className="text-cyan-400 font-mono">{motor.vibration_level.toFixed(3)}g</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Load</span>
                <span className="text-cyan-400 font-mono">{cabin.load_kg.toFixed(0)} kg</span>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Door</p>
              <p className={`text-sm font-mono font-bold ${door.state === 'OPEN' ? 'text-green-400' : door.state === 'BLOCKED' ? 'text-red-400' : 'text-yellow-400'}`}>
                {door.state}
              </p>
            </div>
          </div>
        </div>
      </ChartCard>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-cyan-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Power</span>
          </div>
          <p className="text-2xl font-bold text-gray-100">{motor.power_kw.toFixed(2)} kW</p>
          <p className="text-xs text-gray-500 mt-2">{motor.current_draw_a.toFixed(1)}A draw</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <Thermometer size={16} className="text-orange-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Cabin Temp</span>
          </div>
          <p className="text-2xl font-bold text-gray-100">{cabin.temperature_c.toFixed(1)}°C</p>
          <p className="text-xs text-gray-500 mt-2">Normal range</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <Radio size={16} className="text-purple-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Hours</span>
          </div>
          <p className="text-2xl font-bold text-gray-100">{motor.hours_operated.toFixed(0)}h</p>
          <p className="text-xs text-gray-500 mt-2">Lifetime operation</p>
        </div>
      </div>
    </div>
  );
}
