import { X, AlertTriangle, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function AlertBanner({ alerts }) {
  const [visible, setVisible] = useState(true);

  const critical = alerts.find(a => a.severity === 'CRITICAL');
  if (!critical || !visible) return null;

  const bgClass = 'bg-red-900/40 border border-red-700/50';
  const textClass = 'text-red-400';

  return (
    <div className={`fixed top-16 left-0 right-0 z-40 ${bgClass} backdrop-blur-sm shadow-2xl border-b`}>
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <AlertTriangle size={20} className={`${textClass} animate-pulse flex-shrink-0`} />
          <div>
            <p className={`font-bold text-sm ${textClass} uppercase tracking-wide`}>CRITICAL ALERT</p>
            <p className="text-sm text-red-300 mt-1">{critical.message}</p>
          </div>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="p-1 hover:bg-red-800/50 rounded transition-colors flex-shrink-0"
        >
          <X size={18} className={textClass} />
        </button>
      </div>
    </div>
  );
}
