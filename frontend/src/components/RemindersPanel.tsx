import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type Reminder, createReminder, errorText, getPendingReminders } from "../api";
import { formatMadridDateTime, madridLocalToIso, madridNowLocal, tomorrowAtNineLocal } from "../format";

export function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(tomorrowAtNineLocal);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const loadReminders = useCallback(() => {
    getPendingReminders()
      .then((result) => {
        setReminders(result);
        setLoadError(null);
      })
      .catch((failure: unknown) => setLoadError(errorText(failure)));
  }, []);

  useEffect(loadReminders, [loadReminders]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setCreated(null);
    try {
      const reminder = await createReminder(text.trim(), madridLocalToIso(when));
      setCreated(`Te recordaré "${reminder.text}" el ${formatMadridDateTime(reminder.remind_at)}.`);
      setText("");
      loadReminders();
    } catch (failure) {
      setFormError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="reminders-title">
      <div className="card-header">
        <h2 id="reminders-title">Recordatorios</h2>
      </div>

      <form className="reminder-form" onSubmit={handleSubmit}>
        <label>
          Qué quieres que te recuerde
          <input
            type="text"
            value={text}
            maxLength={500}
            placeholder="Llamar a Juan"
            required
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label>
          Cuándo (hora de Madrid)
          <input
            type="datetime-local"
            value={when}
            min={madridNowLocal()}
            required
            onChange={(event) => setWhen(event.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={saving || !text.trim() || !when}>
          {saving ? "Guardando…" : "Crear recordatorio"}
        </button>
        {formError && (
          <p className="error" role="alert">
            {formError}
          </p>
        )}
        {created && (
          <p className="success" role="status">
            {created}
          </p>
        )}
      </form>

      <h3>Pendientes{reminders ? ` (${reminders.length})` : ""}</h3>
      {loadError ? (
        <p className="error" role="alert">
          {loadError}
        </p>
      ) : reminders === null ? (
        <p className="muted">Cargando…</p>
      ) : reminders.length === 0 ? (
        <p className="empty">No hay recordatorios pendientes.</p>
      ) : (
        <ul className="reminders">
          {reminders.map((reminder) => (
            <li key={reminder.id}>
              <span className="reminder-time">{formatMadridDateTime(reminder.remind_at)}</span>
              <span>{reminder.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
