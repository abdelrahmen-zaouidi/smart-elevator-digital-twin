import { Clock, Bell, AlertCircle } from 'lucide-react';
import { useMemo } from 'react';

const StatusBadge = ({ status }) => {
  const config = {
    LIVE: { bg: 'bg-green-900/40', border: 'border-green-700', text: 'text-green-400', label: 'LIVE' },
    DEGRADED: { bg: 'bg-yellow-900/40', border: 'border-yellow-700', text: 'text-yellow-400', label: 'DEGRADED' },
    CRITICAL: { bg: 'bg-red-900/40', border: 'border-red-700', text: 'text-red-400', label: 'CRITICAL' },
  };
  const c = config[status] || config.LIVE;
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.bg} ${c.border}`}>
      <div className={`w-2 h-2 rounded-full ${c.text} animate-pulse`} />
      <span className={`text-xs font-mono font-semibold ${c.text}`}>{c.label}</span>
    </div>
  );
};

export default function Topbar({ state, alerts }) {
  const time = useMemo(() => {
    const now = new Date();
    return now.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, []);

  const riskStatus = state.attributes.risk_score >= 76 ? 'CRITICAL' : state.attributes.risk_score >= 41 ? 'DEGRADED' : 'LIVE';
  const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL').length;

  return (
    <div className="h-16 bg-gradient-to-r from-gray-950 to-gray-900 border-b border-gray-800 flex items-center justify-between px-6 shadow-lg">
      {/* Left: Status and Location */}
      <div className="flex items-center gap-8">
        <StatusBadge status={riskStatus} />
        <div className="hidden lg:block">
          <p className="text-xs text-gray-500 uppercase tracking-wide">System Location</p>
          <p className="text-sm font-mono text-gray-200">{state.attributes.location}</p>
        </div>
      </div>

      {/* Center: Clock */}
      <div className="flex items-center gap-2 text-gray-400">
        <Clock size={16} />
        <span className="font-mono text-sm">{time}</span>
      </div>

      {/* Right: Alerts & User */}
      <div className="flex items-center gap-6">
        {criticalAlerts > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-900/30 border border-red-700 rounded-lg">
            <AlertCircle size={16} className="text-red-400 animate-pulse" />
            <span className="text-xs font-mono text-red-400 font-semibold">{criticalAlerts} CRITICAL</span>
          </div>
        )}
        <button className="relative p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <Bell size={18} className="text-gray-400 hover:text-gray-300" />
          {alerts.length > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
        <div className="flex items-center gap-2 pl-4 border-l border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
            <span className="text-xs font-bold text-white">SYS</span>
          </div>
          <span className="text-xs font-mono text-gray-400">ADMIN</span>
        </div>
      </div>
    </div>
  );
}
