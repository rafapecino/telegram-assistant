import type { DailyTotal } from "../api";
import { formatDay, formatEuros } from "../format";
import { chartBars } from "../stats";

interface Props {
  byDay: DailyTotal[];
  days: number;
}

// Unidades del viewBox: cada barra ocupa 10 de ancho (8 de barra y 2 de hueco) y la altura es 100.
const SLOT = 10;
const BAR = 8;

function barLabel(start: string, end: string, amount: number): string {
  const when = start === end ? formatDay(start) : `Semana del ${formatDay(start)} al ${formatDay(end)}`;
  return `${when}: ${formatEuros(amount)}`;
}

/** Gasto por día (7 y 30 días) o por semana (90 días) en barras SVG. */
export function SpendingChart({ byDay, days }: Props) {
  const bars = chartBars(byDay, days);
  const max = Math.max(0, ...bars.map((bar) => bar.amount));
  const unit = days > 30 ? "semana" : "día";

  if (max === 0) return <p className="empty">No hay gastos en este periodo.</p>;

  return (
    <figure className="chart">
      <figcaption className="chart-caption">
        <span>Máximo por {unit}</span>
        <span className="number">{formatEuros(max)}</span>
      </figcaption>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${bars.length * SLOT} 100`}
        preserveAspectRatio="none"
        role="list"
        aria-label={`Gasto por ${unit}`}
      >
        {bars.map((bar, index) => {
          const label = barLabel(bar.start, bar.end, bar.amount);
          // Los días con gasto, por pequeño que sea, se ven con al menos 2 unidades de alto.
          const height = bar.amount > 0 ? Math.max(2, (bar.amount / max) * 100) : 0;
          return (
            <g key={bar.start} role="listitem" aria-label={label}>
              <title>{label}</title>
              {/* Zona transparente de toda la altura para que el tooltip salga también en barras bajas o vacías. */}
              <rect className="chart-hit" x={index * SLOT} y={0} width={SLOT} height={100} />
              {height > 0 && <rect className="chart-bar" x={index * SLOT + 1} y={100 - height} width={BAR} height={height} />}
            </g>
          );
        })}
      </svg>
      <div className="chart-axis" aria-hidden="true">
        <span>{formatDay(bars[0].start)}</span>
        <span>{formatDay(bars[bars.length - 1].end)}</span>
      </div>
    </figure>
  );
}
