import { useEffect, useState } from "react";
import {
  AUTH_REQUIRED_EVENT,
  type ExpenseSummary,
  clearToken,
  errorText,
  getExpenseSummary,
  getToken,
  setToken,
} from "./api";
import { ExpensesPanel } from "./components/ExpensesPanel";
import { LoginForm } from "./components/LoginForm";
import { RemindersPanel } from "./components/RemindersPanel";

const DAY_OPTIONS = [7, 30, 90];

export function App() {
  const [authenticated, setAuthenticated] = useState(() => getToken() !== null);
  const [tokenRejected, setTokenRejected] = useState(false);
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Asistente personal</h1>
          <p className="muted">Tus gastos y recordatorios del bot de Telegram.</p>
        </div>
        {authenticated && (
          <button type="button" className="secondary" onClick={logOut}>
            Salir
          </button>
        )}
      </header>

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
                <ExpensesPanel summary={summary} />
              </div>
            ) : (
              <p className="muted">Cargando…</p>
            )}
          </section>

          <RemindersPanel />
        </main>
      )}
    </div>
  );
}
