import type { ExpenseSummary } from "../api";
import { formatDay, formatEuros } from "../format";
import { categoryShares, describePeriodChange } from "../stats";
import { SpendingChart } from "./SpendingChart";

interface Props {
  summary: ExpenseSummary;
  /** Gasto cuya categoría se está guardando. */
  savingExpenseId: number | null;
  categoryError: string | null;
  onCategoryChange: (expenseId: number, category: string) => void;
}

export function ExpensesPanel({ summary, savingExpenseId, categoryError, onCategoryChange }: Props) {
  const shares = categoryShares(summary.by_category, summary.total);
  const change = describePeriodChange(summary.total, summary.previous_total, summary.days);

  return (
    <>
      <div className="stats">
        <div className="stat stat-primary">
          <span className="stat-label">Total en {summary.days} días</span>
          <span className="stat-value">{formatEuros(summary.total)}</span>
          <span className={`stat-change change-${change.tone}`}>{change.text}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Nº de gastos</span>
          <span className="stat-value">{summary.count}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Media diaria</span>
          <span className="stat-value">{formatEuros(summary.total / summary.days)}</span>
        </div>
      </div>

      <h3>{summary.days > 30 ? "Gasto por semana" : "Gasto por día"}</h3>
      <SpendingChart byDay={summary.by_day} days={summary.days} />

      {shares.length > 0 && (
        <>
          <h3>Por categoría</h3>
          <ul className="bars">
            {shares.map(({ category, amount, percent }) => (
              <li key={category}>
                <span className="bar-label" title={category}>
                  {category}
                </span>
                <span className="bar-track" aria-hidden="true">
                  <span className="bar-fill" style={{ width: `${percent}%` }} />
                </span>
                <span className="bar-value">
                  {formatEuros(amount)} <span className="muted">· {percent}&nbsp;%</span>
                </span>
              </li>
            ))}
          </ul>

          <h3>Gastos más grandes</h3>
          {categoryError && (
            <p className="error" role="alert">
              {categoryError}
            </p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="date-column">
                    Fecha
                  </th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Categoría</th>
                  <th scope="col" className="number">
                    Importe
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.largest.map((expense) => (
                  <tr key={expense.id}>
                    <td className="nowrap date-column">{formatDay(expense.booking_date)}</td>
                    <td className="description">
                      {expense.description}
                      {/* En móvil la columna de fecha se oculta y la fecha va aquí debajo. */}
                      <span className="inline-date muted">{formatDay(expense.booking_date)}</span>
                    </td>
                    <td>
                      <select
                        className="tag-select"
                        value={expense.category}
                        aria-label={`Categoría de ${expense.description}`}
                        aria-busy={savingExpenseId === expense.id}
                        onChange={(event) => onCategoryChange(expense.id, event.target.value)}
                      >
                        {summary.categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="number">{formatEuros(expense.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
