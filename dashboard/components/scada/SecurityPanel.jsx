import { AlertTriangle, Shield, Lock, Radio } from 'lucide-react';
import ChartCard from './ChartCard';

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'CRITICAL': return 'text-red-400 bg-red-900/30 border-red-700';
    case 'WARNING': return 'text-yellow-400 bg-yellow-900/30 border-yellow-700';
    case 'HIGH': return 'text-orange-400 bg-orange-900/30 border-orange-700';
    default: return 'text-green-400 bg-green-900/30 border-green-700';
  }
};

export default function SecurityPanel({ state, alerts }) {
  const security = state.features.security.properties;
  const incidents = state.features.incident_log.properties.entries;
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;
  const warningCount = alerts.filter(a => a.severity === 'WARNING').length;

  const formatTime = (ts) => {
    try {
      const date = new Date(ts);
      const now = new Date();
      const diff = now - date;
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      if (minutes === 0) return `${seconds}s ago`;
      if (minutes < 60) return `${minutes}m ago`;
      return date.toLocaleTimeString('en-GB', { hour12: false });
    } catch {
      return ts;
    }
  };

  return (
    <div className="space-y-6">
      {/* Security Status Overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className={`bg-gray-900 border rounded-2xl p-4 ${
          security.alert_level === 'CRITICAL' ? 'border-red-700' :
          security.alert_level === 'HIGH' ? 'border-yellow-700' :
          'border-gray-800'
        } hover:border-gray-700 transition-colors`}>
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className={
              security.alert_level === 'CRITICAL' ? 'text-red-400' :
              security.alert_level === 'HIGH' ? 'text-yellow-400' :
              'text-green-400'
            } />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Alert Level</span>
          </div>
          <p className={`text-2xl font-bold ${
            security.alert_level === 'CRITICAL' ? 'text-red-400' :
            security.alert_level === 'HIGH' ? 'text-yellow-400' :
            'text-green-400'
          }`}>{security.alert_level}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className={criticalCount > 0 ? 'text-red-400' : 'text-gray-500'} />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Critical Incidents</span>
          </div>
          <p className={`text-2xl font-bold ${criticalCount > 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {criticalCount}
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <Radio size={16} className="text-yellow-400" />
            <span className="text-xs text-gray-500 uppercase tracking-wide">Unauthorized Attempts</span>
          </div>
          <p className={`text-2xl font-bold ${security.unauthorized_access_attempts > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
            {security.unauthorized_access_attempts}
          </p>
        </div>
      </div>

      {/* Incident Timeline */}
      <ChartCard title="Incident Timeline" icon="📋" subtitle="Recent security and system events">
        <div className="max-h-96 overflow-y-auto space-y-2">
          {incidents.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">No incidents recorded</p>
            </div>
          ) : (
            incidents.map((incident, idx) => {
              const isUnresolved = !incident.resolved;
              return (
                <div
                  key={incident.incident_id}
                  className={`p-3 rounded-lg border transition-all ${
                    incident.type.includes('SECURITY') || incident.type.includes('FORCED') || incident.type.includes('LOCKDOWN')
                      ? 'bg-red-900/20 border-red-700/50'
                      : incident.type.includes('VIBRATION') || incident.type.includes('OVERLOAD')
                      ? 'bg-yellow-900/20 border-yellow-700/50'
                      : 'bg-gray-800/50 border-gray-700/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-mono font-bold text-gray-400">{incident.incident_id}</p>
                        <span className={`text-xs px-2 py-1 rounded font-mono font-bold ${
                          incident.type.includes('SECURITY') || incident.type.includes('FORCED')
                            ? 'bg-red-900/50 text-red-400'
                            : incident.type.includes('VIBRATION')
                            ? 'bg-yellow-900/50 text-yellow-400'
                            : 'bg-gray-800 text-gray-400'
                        }`}>
                          {incident.type}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 mb-2">{incident.description}</p>
                      <p className="text-xs text-gray-500">{formatTime(incident.ts)}</p>
                    </div>
                    {isUnresolved && (
                      <span className="text-xs px-2 py-1 rounded bg-orange-900/50 text-orange-400 font-mono font-bold">
                        OPEN
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ChartCard>

      {/* Access Control */}
      <ChartCard title="Access Control" icon="🔐" subtitle="RFID and security status">
        <div className="space-y-3">
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Last RFID Card</p>
            <p className="text-sm font-mono text-gray-200">{security.rfid_last_card}</p>
            <p className={`text-xs mt-2 ${security.rfid_access_granted ? 'text-green-400' : 'text-red-400'}`}>
              {security.rfid_access_granted ? '✓ Access Granted' : '✗ Access Denied'}
            </p>
          </div>

          <div className={`rounded-lg p-3 border ${
            security.audio_distress_active
              ? 'bg-red-900/30 border-red-700'
              : 'bg-gray-800/50 border-gray-700'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Audio Distress</span>
              <span className={`text-sm font-bold ${security.audio_distress_active ? 'text-red-400 animate-pulse' : 'text-gray-500'}`}>
                {security.audio_distress_active ? '⚠️ ACTIVE' : 'Normal'}
              </span>
            </div>
          </div>

          <div className={`rounded-lg p-3 border ${
            security.door_forced_entry
              ? 'bg-red-900/30 border-red-700'
              : 'bg-gray-800/50 border-gray-700'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Door Integrity</span>
              <span className={`text-sm font-bold ${security.door_forced_entry ? 'text-red-400 animate-pulse' : 'text-green-400'}`}>
                {security.door_forced_entry ? '⚠️ BREACHED' : '✓ Secure'}
              </span>
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
