import type { ExpenseSummary } from "../api";
import { formatDay, formatEuros } from "../format";

interface Props {
  summary: ExpenseSummary;
}

export function ExpensesPanel({ summary }: Props) {
  const categories = Object.entries(summary.by_category);
  const largestCategoryAmount = Math.max(0, ...categories.map(([, amount]) => amount));

  return (
    <>
      <div className="stats">
        <div className="stat stat-primary">
          <span className="stat-label">Total en {summary.days} días</span>
          <span className="stat-value">{formatEuros(summary.total)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Gastos</span>
          <span className="stat-value">{summary.count}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Media diaria</span>
          <span className="stat-value">{formatEuros(summary.total / summary.days)}</span>
        </div>
      </div>

      {categories.length === 0 ? (
        <p className="empty">No hay gastos en este periodo.</p>
      ) : (
        <>
          <h3>Por categoría</h3>
          <ul className="bars">
            {categories.map(([category, amount]) => (
              <li key={category}>
                <span className="bar-label" title={category}>
                  {category}
                </span>
                <span className="bar-track" aria-hidden="true">
                  <span
                    className="bar-fill"
                    style={{ width: `${largestCategoryAmount ? (amount / largestCategoryAmount) * 100 : 0}%` }}
                  />
                </span>
                <span className="bar-value">{formatEuros(amount)}</span>
              </li>
            ))}
          </ul>

          <h3>Gastos más grandes</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Categoría</th>
                  <th scope="col" className="number">
                    Importe
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.largest.map((expense, index) => (
                  <tr key={index}>
                    <td className="nowrap">{formatDay(expense.booking_date)}</td>
                    <td>{expense.description}</td>
                    <td>
                      <span className="tag">{expense.category}</span>
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
