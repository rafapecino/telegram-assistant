import { useEffect, useState } from "react";
import {
  AUTH_REQUIRED_EVENT,
  type ExpenseSummary,
  clearToken,
  errorText,
  getExpenseSummary,
  getToken,
  setToken,
  updateExpenseCategory,
} from "./api";
import logoUrl from "./assets/stratesys-logo.svg";
import { ExpenseChat } from "./components/ExpenseChat";
import { ExpensesPanel } from "./components/ExpensesPanel";
import { LoginForm } from "./components/LoginForm";
import { RemindersPanel } from "./components/RemindersPanel";
import { moveExpense } from "./stats";

const DAY_OPTIONS = [7, 30, 90];

export function App() {
  const [authenticated, setAuthenticated] = useState(() => getToken() !== null);
  const [tokenRejected, setTokenRejected] = useState(false);
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingExpenseId, setSavingExpenseId] = useState<number | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // Cualquier 401 de la API devuelve a la pantalla del token.
  useEffect(() => {
    const onAuthRequired = () => {
      setAuthenticated(false);
      setTokenRejected(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCategoryError(null);
    getExpenseSummary(days)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorText(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, authenticated]);

  // Se aplica al momento y se deshace si la API falla.
  async function changeCategory(expenseId: number, category: string) {
    const previous = summary?.largest.find((expense) => expense.id === expenseId)?.category;
    if (!previous || previous === category) return;
    setCategoryError(null);
    setSavingExpenseId(expenseId);
    setSummary((current) => current && moveExpense(current, expenseId, category));
    try {
      await updateExpenseCategory(expenseId, category);
    } catch (failure) {
      // Solo se revierte si nadie lo ha cambiado otra vez mientras tanto.
      setSummary((current) =>
        current?.largest.find((expense) => expense.id === expenseId)?.category === category
          ? moveExpense(current, expenseId, previous)
          : current,
      );
      setCategoryError(`No se pudo cambiar la categoría: ${errorText(failure)}`);
    } finally {
      setSavingExpenseId((current) => (current === expenseId ? null : current));
    }
  }

  function logIn(token: string) {
    setToken(token);
    setTokenRejected(false);
    setAuthenticated(true);
  }

  function logOut() {
    clearToken();
    setSummary(null);
    setTokenRejected(false);
    setAuthenticated(false);
  }

  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-top">
            <img className="brand-logo" src={logoUrl} alt="Stratesys" width="124" height="21" />
            {authenticated && (
              <button type="button" className="ghost" onClick={logOut}>
                Salir
              </button>
            )}
          </div>
          <h1>Asistente personal</h1>
          <p className="hero-subtitle">Tus gastos y recordatorios del bot de Telegram.</p>
        </div>
      </header>

      <div className="page">
        {!authenticated ? (
          <LoginForm rejected={tokenRejected} onSubmit={logIn} />
        ) : (
          <main className="layout">
            <section className="card" aria-labelledby="expenses-title" aria-busy={loading}>
              <div className="card-header">
                <h2 id="expenses-title">Gastos</h2>
                <div className="segmented" role="group" aria-label="Periodo de los gastos">
                  {DAY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={option === days}
                      className={option === days ? "active" : ""}
                      onClick={() => setDays(option)}
                    >
                      {option} días
                    </button>
                  ))}
                </div>
              </div>

              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : summary ? (
                // Al cambiar de periodo se mantienen los datos anteriores atenuados hasta que llegan los nuevos.
                <div className={loading ? "is-loading" : undefined}>
                  <ExpensesPanel
                    summary={summary}
                    savingExpenseId={savingExpenseId}
                    categoryError={categoryError}
                    onCategoryChange={changeCategory}
                  />
                </div>
              ) : (
                <p className="muted">Cargando…</p>
              )}
            </section>

            <div className="side-column">
              <ExpenseChat />
              <RemindersPanel />
            </div>
          </main>
        )}
      </div>
    </>
  );
}
