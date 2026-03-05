import { useRaceStore } from '../stores/raceStore'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'

const COMPOUND_COLORS: Record<string, string> = {
  soft: '#FF3333',
  medium: '#FFD700',
  hard: '#CCCCCC',
  intermediate: '#43A047',
  wet: '#2196F3',
}

export function DashboardAnalytics() {
  const { dashboardData, setShowDashboard } = useRaceStore()

  if (!dashboardData) return null

  const { lap_times, stint_summary, degradation_curve, total_time, pit_history, consistency_score, sector_evolution } = dashboardData

  const bestLap = lap_times.length > 0 ? Math.min(...lap_times.map((l) => l.time)) : 0
  const totalLaps = lap_times.length

  // Lap time chart data
  const lapChartData = lap_times.map((l) => ({
    lap: l.lap,
    time: l.time,
    compound: l.compound,
  }))

  // Stint bar chart data
  const stintBarData = stint_summary.map((s, i) => ({
    name: `S${i + 1} (${s.compound.charAt(0).toUpperCase()})`,
    avg: s.avg_time,
    best: s.best_time,
    compound: s.compound,
    laps: s.laps,
  }))

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60)
    const s = (secs % 60).toFixed(1)
    return mins > 0 ? `${mins}:${s.padStart(4, '0')}` : `${s}s`
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-panel border border-border rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-panel z-10">
          <h2 className="text-sm font-bold text-white">Post-Race Analysis</h2>
          <button
            onClick={() => setShowDashboard(false)}
            className="text-gray-400 hover:text-white px-2 py-1 rounded border border-border text-[10px]"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Race Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Total Time" value={formatTime(total_time)} />
            <SummaryCard label="Total Laps" value={String(totalLaps)} />
            <SummaryCard label="Best Lap" value={bestLap > 0 ? `${bestLap.toFixed(3)}s` : '--'} color="#00c853" />
            <SummaryCard label="Consistency" value={`${consistency_score}%`} color={consistency_score > 80 ? '#00c853' : consistency_score > 60 ? '#ffd54f' : '#e10600'} />
          </div>

          {/* Pit Stops */}
          {pit_history.length > 0 && (
            <div className="bg-panel2 rounded p-3">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase mb-1">Pit Stops</h3>
              <div className="flex gap-3">
                {pit_history.map((p, i) => (
                  <div key={i} className="text-[10px]">
                    <span className="text-gray-500">Stop {i + 1}:</span>{' '}
                    <span className="font-bold">L{p.lap}</span>{' '}
                    <span style={{ color: COMPOUND_COLORS[p.compound] || '#fff' }}>
                      {p.compound.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lap Time Chart */}
          <div className="bg-panel2 rounded p-3">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase mb-2">Lap Times</h3>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={lapChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                  <XAxis dataKey="lap" tick={{ fontSize: 9, fill: '#6b7280' }} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    tickFormatter={(v: number) => `${v.toFixed(1)}s`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0d0d1a', border: '1px solid #1a1a2e', fontSize: 10 }}
                    formatter={(value: number, _name: string, props: any) => [
                      `${value.toFixed(3)}s (${props.payload.compound})`,
                      'Lap Time',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="time"
                    stroke="#2196F3"
                    strokeWidth={1.5}
                    dot={(props: any) => {
                      const color = COMPOUND_COLORS[props.payload?.compound] || '#2196F3'
                      return (
                        <circle
                          cx={props.cx}
                          cy={props.cy}
                          r={2}
                          fill={color}
                          stroke="none"
                        />
                      )
                    }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Stint Analysis */}
          {stintBarData.length > 0 && (
            <div className="bg-panel2 rounded p-3">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase mb-2">Stint Averages</h3>
              <div className="h-32">
                <ResponsiveContainer>
                  <BarChart data={stintBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#6b7280' }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#6b7280' }} />
                    <Tooltip
                      contentStyle={{ background: '#0d0d1a', border: '1px solid #1a1a2e', fontSize: 10 }}
                      formatter={(value: number) => [`${value.toFixed(3)}s`, 'Avg Time']}
                    />
                    <Bar dataKey="avg" isAnimationActive={false}>
                      {stintBarData.map((entry, i) => (
                        <Cell key={i} fill={COMPOUND_COLORS[entry.compound] || '#666'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Degradation */}
          {degradation_curve.length > 0 && (
            <div className="bg-panel2 rounded p-3">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase mb-1">Tyre Degradation</h3>
              <div className="space-y-1">
                {degradation_curve.map((d) => (
                  <div key={d.stint} className="flex items-center gap-2 text-[10px]">
                    <span className="text-gray-500 w-14">Stint {d.stint}</span>
                    <span style={{ color: COMPOUND_COLORS[d.compound] || '#fff' }} className="w-14 font-bold">
                      {d.compound.toUpperCase()}
                    </span>
                    <span className={d.slope > 0.05 ? 'text-f1red' : d.slope > 0.02 ? 'text-f1yellow' : 'text-f1green'}>
                      {d.slope > 0 ? '+' : ''}{d.slope.toFixed(4)}s/lap
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sector Evolution */}
          {sector_evolution.length > 0 && sector_evolution.some((s) => s.s1 > 0) && (
            <div className="bg-panel2 rounded p-3">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase mb-1">Sector Times</h3>
              <div className="max-h-32 overflow-y-auto">
                <table className="w-full text-[9px]">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left py-0.5">Lap</th>
                      <th className="text-right">S1</th>
                      <th className="text-right">S2</th>
                      <th className="text-right">S3</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sector_evolution.filter((s) => s.s1 > 0).map((s) => (
                      <tr key={s.lap}>
                        <td className="py-0.5 text-gray-400">L{s.lap}</td>
                        <td className="text-right font-mono">{s.s1.toFixed(3)}</td>
                        <td className="text-right font-mono">{s.s2.toFixed(3)}</td>
                        <td className="text-right font-mono">{s.s3.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-panel2 rounded p-2 text-center">
      <div className="text-[8px] text-gray-500 uppercase">{label}</div>
      <div className="text-sm font-bold mt-0.5" style={color ? { color } : undefined}>{value}</div>
    </div>
  )
}
