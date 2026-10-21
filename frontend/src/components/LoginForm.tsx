import { type FormEvent, useState } from "react";

interface Props {
  rejected: boolean;
  onSubmit: (token: string) => void;
}

/** Pide el PANEL_TOKEN del .env de la API. */
export function LoginForm({ rejected, onSubmit }: Props) {
  const [token, setToken] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(token.trim());
  }

  return (
    <section className="card login" aria-labelledby="login-title">
      <h2 id="login-title">Acceso al panel</h2>
      <p className="muted">Escribe el valor de PANEL_TOKEN del archivo .env de la API.</p>
      <form className="reminder-form" onSubmit={handleSubmit}>
        <label>
          Token
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            required
            autoFocus
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {rejected && (
          <p className="error" role="alert">
            El token no es correcto.
          </p>
        )}
        <button type="submit" className="primary" disabled={!token.trim()}>
          Entrar
        </button>
      </form>
    </section>
  );
}
