import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { id: 'command', label: 'Command Center', icon: '◈' },
  { id: 'twin', label: 'Digital Twin', icon: '⬡' },
  { id: 'analytics', label: 'AI Analytics', icon: '◎' },
  { id: 'soc', label: 'Security Ops', icon: '⊗' },
  { id: 'maintenance', label: 'Maintenance', icon: '⚙' },
  { id: 'simulation', label: 'Simulation Lab', icon: '⚡' },
];

export default function Sidebar({ activePage, onPageChange }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className={`h-screen bg-gradient-to-b from-gray-950 to-gray-900 border-r border-gray-800 flex flex-col transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'} shadow-2xl`}>
      {/* Logo */}
      <div className="px-6 py-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-bold text-white">⬡</span>
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-sm font-bold text-gray-100">ElevatorOS</h1>
              <p className="text-xs text-gray-500">SCADA Platform v2.0</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onPageChange(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activePage === item.id
                ? 'bg-gradient-to-r from-cyan-600/40 to-blue-600/40 border border-cyan-500/50 shadow-lg shadow-cyan-500/20'
                : 'hover:bg-gray-800/50 border border-gray-800/50'
            }`}
            title={item.label}
          >
            <span className="text-xl flex-shrink-0">{item.icon}</span>
            {!isCollapsed && (
              <span className="text-sm font-medium text-gray-300 group-hover:text-gray-100 transition-colors">
                {item.label}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-6 border-t border-gray-800">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center justify-center py-2 rounded-lg hover:bg-gray-800/50 transition-colors text-gray-400 hover:text-gray-300"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          <span className="text-xl">{isCollapsed ? '→' : '←'}</span>
        </button>
      </div>
    </div>
  );
}
