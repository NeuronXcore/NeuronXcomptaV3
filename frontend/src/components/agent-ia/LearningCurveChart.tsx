import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { LearningCurve } from '@/types'

interface LearningCurveChartProps {
  learningCurve?: LearningCurve
}

export default function LearningCurveChart({ learningCurve }: LearningCurveChartProps) {
  const chartData = useMemo(() => {
    if (!learningCurve?.dates?.length) return []
    return learningCurve.dates.map((date, i) => ({
      date: date.slice(0, 10),
      'Précision entraînement': Number((learningCurve.acc_train[i] * 100).toFixed(1)),
      'Précision test': Number((learningCurve.acc_test[i] * 100).toFixed(1)),
      'F1 Score': Number((learningCurve.f1[i] * 100).toFixed(1)),
      samples: learningCurve.n_samples[i],
      rules: learningCurve.nb_regles[i],
    }))
  }, [learningCurve])

  return (
    <div className="bg-surface rounded-xl border border-border p-5 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-4">
        <TrendingUp size={16} className="text-primary" />
        Courbe d'apprentissage
      </h3>

      {chartData.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-text-muted/60 text-center">
            Aucune donnée d'apprentissage.<br />
            Lancez un entraînement pour voir la courbe.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#e2e8f0',
                }}
                formatter={(value, name) => [`${value}%`, String(name)]}
                labelFormatter={(label) => `Session: ${String(label)}`}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }}
                iconSize={8}
              />
              <Line
                type="monotone"
                dataKey="Précision entraînement"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3, fill: '#22c55e' }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="Précision test"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: '#3b82f6' }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="F1 Score"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: '#f59e0b' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stats sous le graphique */}
      {chartData.length > 0 && (
        <div className="flex gap-4 mt-3 pt-3 border-t border-border/30 text-[10px] text-text-muted/60">
          <span>{chartData.length} sessions</span>
          <span>Dernier: {chartData[chartData.length - 1].date}</span>
          <span>{chartData[chartData.length - 1].samples} exemples</span>
          <span>{chartData[chartData.length - 1].rules} règles</span>
        </div>
      )}
    </div>
  )
}
