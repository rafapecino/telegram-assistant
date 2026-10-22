import { useEffect, useState } from "react";
import { type BalanceMonth, type BalanceSummary, errorText, getBalance } from "../api";
import { barScale, barWidth, savingsRate } from "../balance";
import { formatDay, formatEuros, formatMonth } from "../format";

const MONTHS_SHOWN = 6;

function formatSavings(month: BalanceMonth): string {
  if (month.savings === null) return "Sin datos";
  const rate = savingsRate(month);
  const sign = month.savings > 0 ? "+" : "";
  return `${sign}${formatEuros(month.savings)}${rate === null ? "" : ` · ${rate} %`}`;
}

function MonthRow({ month, scale }: { month: BalanceMonth; scale: number }) {
  const isNegative = month.savings !== null && month.savings < 0;
  return (
    <li className="balance-month">
      <span className="balance-label">{formatMonth(month.month)}</span>
      <div className="balance-bars">
        <div className="balance-bar income">
          <span className="balance-track" aria-hidden="true">
            <span className="balance-fill" style={{ width: `${barWidth(month.incomes ?? 0, scale)}%` }} />
          </span>
          <span className="number">{month.incomes === null ? "—" : formatEuros(month.incomes)}</span>
        </div>
        <div className="balance-bar expense">
          <span className="balance-track" aria-hidden="true">
            <span className="balance-fill" style={{ width: `${barWidth(month.expenses, scale)}%` }} />
          </span>
          <span className="number">{formatEuros(month.expenses)}</span>
        </div>
      </div>
      <span className={isNegative ? "balance-savings number negative" : "balance-savings number"}>
        {formatSavings(month)}
      </span>
    </li>
  );
}

function BalanceContent({ balance }: { balance: BalanceSummary }) {
  const current = balance.months[balance.months.length - 1];
  const rate = savingsRate(current);
  const scale = barScale(balance.months);
  return (
    <>
      <div className="stats stats-even">
        <div className="stat">
          <span className="stat-label">
            <span className="dot income" aria-hidden="true" /> Ingresos este mes
          </span>
          <span className="stat-value">{current.incomes === null ? "—" : formatEuros(current.incomes)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">
            <span className="dot expense" aria-hidden="true" /> Gastos este mes
          </span>
          <span className="stat-value">{formatEuros(current.expenses)}</span>
        </div>
        <div className="stat stat-dark">
          <span className="stat-label">Ahorro este mes</span>
          <span className="stat-value">{current.savings === null ? "—" : formatEuros(current.savings)}</span>
          {rate !== null && <span className="stat-note">{rate} % de lo ingresado</span>}
        </div>
      </div>

      <h3>Por mes</h3>
      <ul className="balance-legend" aria-label="Leyenda">
        <li>
          <span className="dot income" aria-hidden="true" /> Ingresos
        </li>
        <li>
          <span className="dot expense" aria-hidden="true" /> Gastos
        </li>
        <li className="muted">Ahorro y % de lo ingresado a la derecha</li>
      </ul>
      <ul className="balance-months">
        {[...balance.months].reverse().map((month) => <MonthRow key={month.month} month={month} scale={scale} />)}
      </ul>
      <p className="muted balance-note">
        {balance.incomes_since
          ? `Los ingresos se registran desde el ${formatDay(balance.incomes_since)}.`
          : "Aún no hay ingresos guardados: el bot los importa del banco cada día a las 8:00."}
      </p>
    </>
  );
}

/** Ingresos frente a gastos de los últimos meses. */
export function BalancePanel() {
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBalance(MONTHS_SHOWN)
      .then(setBalance)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, []);

  return (
    <section className="card" aria-labelledby="balance-title" aria-busy={balance === null && error === null}>
      <div className="card-header">
        <h2 id="balance-title">Balance</h2>
        <span className="muted">Últimos {MONTHS_SHOWN} meses</span>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : balance ? (
        <BalanceContent balance={balance} />
      ) : (
        <p className="muted">Cargando…</p>
      )}
    </section>
  );
}
