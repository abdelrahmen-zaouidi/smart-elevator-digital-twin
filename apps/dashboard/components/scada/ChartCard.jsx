export default function ChartCard({ title, subtitle, children, icon = null }) {
  return (
    <div className="h-full bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-colors shadow-lg">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {icon && <span className="text-lg">{icon}</span>}
            <h3 className="text-sm font-bold text-gray-100 uppercase tracking-wide">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>

      {/* Content */}
      <div className="h-full">
        {children}
      </div>
    </div>
  );
}
