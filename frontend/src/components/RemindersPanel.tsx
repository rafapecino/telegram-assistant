import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type Reminder,
  completeReminder,
  createReminder,
  deleteReminder,
  errorText,
  getPendingReminders,
} from "../api";
import {
  formatMadridDateTime,
  formatReminderWhen,
  inOneHourLocal,
  madridLocalToIso,
  madridNowLocal,
  nextMondayAtNineLocal,
  tomorrowAtNineLocal,
} from "../format";
import { type ReminderFormError, validateReminderForm } from "../validation";

/** Tiempo para deshacer un borrado antes de enviarlo a la API. */
const UNDO_MS = 5000;

const byTime = (a: Reminder, b: Reminder) => Date.parse(a.remind_at) - Date.parse(b.remind_at);

interface PendingDelete {
  reminder: Reminder;
  timer: number;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10M9 9v4M11 9v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(tomorrowAtNineLocal);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<ReminderFormError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Reminder | null>(null);
  const pendingDelete = useRef<PendingDelete | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const whenRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  const loadReminders = useCallback(() => {
    getPendingReminders()
      .then((result) => {
        setReminders(result);
        setLoadError(null);
      })
      .catch((failure: unknown) => setLoadError(errorText(failure)));
  }, []);

  useEffect(loadReminders, [loadReminders]);

  // "Hoy" y "Mañana" tienen que cambiar solos al pasar la medianoche.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (formOpen) textRef.current?.focus();
  }, [formOpen]);

  useEffect(() => {
    if (undoable) undoRef.current?.focus();
  }, [undoable]);

  const restore = useCallback((reminder: Reminder) => {
    setReminders((current) => (current ? [...current, reminder].sort(byTime) : current));
  }, []);

  const removeFromList = (reminderId: number) =>
    setReminders((current) => current && current.filter((item) => item.id !== reminderId));

  const commitDelete = useCallback(
    (entry: PendingDelete) => {
      window.clearTimeout(entry.timer);
      deleteReminder(entry.reminder.id).catch((failure: unknown) => {
        restore(entry.reminder);
        setActionError(`No se pudo borrar "${entry.reminder.text}": ${errorText(failure)}`);
      });
    },
    [restore],
  );

  // Si se sale del panel con un borrado pendiente, se envía ya.
  useEffect(
    () => () => {
      if (pendingDelete.current) commitDelete(pendingDelete.current);
      pendingDelete.current = null;
    },
    [commitDelete],
  );

  function focusHeading() {
    headingRef.current?.focus();
  }

  function handleDelete(reminder: Reminder) {
    if (pendingDelete.current) commitDelete(pendingDelete.current);
    setActionError(null);
    setNotice(null);
    removeFromList(reminder.id);
    const timer = window.setTimeout(() => {
      const entry = pendingDelete.current;
      pendingDelete.current = null;
      const toastHadFocus = toastRef.current?.contains(document.activeElement) ?? false;
      setUndoable(null);
      if (entry) commitDelete(entry);
      if (toastHadFocus) focusHeading();
    }, UNDO_MS);
    pendingDelete.current = { reminder, timer };
    setUndoable(reminder);
  }

  function undoDelete() {
    const entry = pendingDelete.current;
    if (!entry) return;
    window.clearTimeout(entry.timer);
    pendingDelete.current = null;
    restore(entry.reminder);
    setUndoable(null);
    focusHeading();
  }

  async function handleComplete(reminder: Reminder) {
    setActionError(null);
    removeFromList(reminder.id);
    focusHeading();
    try {
      await completeReminder(reminder.id);
      setNotice(`Completado: "${reminder.text}".`);
    } catch (failure) {
      restore(reminder);
      setActionError(`No se pudo completar "${reminder.text}": ${errorText(failure)}`);
    }
  }

  function openForm() {
    setNotice(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setFieldError(null);
    setFormError(null);
    toggleRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const invalid = validateReminderForm(text, when, madridNowLocal());
    setFieldError(invalid);
    setFormError(null);
    if (invalid) {
      (invalid.field === "text" ? textRef : whenRef).current?.focus();
      return;
    }
    setSaving(true);
    try {
      const reminder = await createReminder(text.trim(), madridLocalToIso(when));
      restore(reminder);
      setNotice(`Te recordaré "${reminder.text}" el ${formatMadridDateTime(reminder.remind_at)}.`);
      setText("");
      closeForm();
    } catch (failure) {
      setFormError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }

  const shortcuts = [
    { label: "En 1 h", value: () => inOneHourLocal() },
    { label: "Mañana 9:00", value: () => tomorrowAtNineLocal() },
    { label: "Lunes 9:00", value: () => nextMondayAtNineLocal() },
  ];

  return (
    <section className="card" aria-labelledby="reminders-title">
      <div className="card-header">
        <h2 id="reminders-title">Recordatorios</h2>
      </div>

      <h3 ref={headingRef} tabIndex={-1} className="first-heading">
        Pendientes{reminders ? ` (${reminders.length})` : ""}
      </h3>
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
              <div className="reminder-body">
                <time className="reminder-time" dateTime={reminder.remind_at} title={formatMadridDateTime(reminder.remind_at)}>
                  {formatReminderWhen(reminder.remind_at, now)}
                </time>
                <span className="reminder-text">{reminder.text}</span>
              </div>
              <div className="reminder-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Completar "${reminder.text}"`}
                  title="Completar"
                  onClick={() => handleComplete(reminder)}
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Borrar "${reminder.text}"`}
                  title="Borrar"
                  onClick={() => handleDelete(reminder)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      <p className="success notice" role="status">
        {notice}
      </p>

      <button
        ref={toggleRef}
        type="button"
        className="secondary add-button"
        aria-expanded={formOpen}
        aria-controls="reminder-form"
        onClick={formOpen ? closeForm : openForm}
      >
        + Nuevo recordatorio
      </button>

      {formOpen && (
        <form id="reminder-form" className="reminder-form" noValidate onSubmit={handleSubmit}>
          <label>
            Qué quieres que te recuerde
            <input
              ref={textRef}
              type="text"
              value={text}
              maxLength={500}
              placeholder="Llamar a Juan"
              aria-invalid={fieldError?.field === "text"}
              aria-describedby={fieldError?.field === "text" ? "reminder-field-error" : undefined}
              onChange={(event) => {
                setText(event.target.value);
                if (fieldError?.field === "text") setFieldError(null);
              }}
            />
          </label>
          {fieldError?.field === "text" && (
            <p id="reminder-field-error" className="field-error">
              {fieldError.message}
            </p>
          )}
          <div className="when-field">
            <label>
              Cuándo (hora de Madrid)
              <input
                ref={whenRef}
                type="datetime-local"
                value={when}
                min={madridNowLocal(now)}
                aria-invalid={fieldError?.field === "when"}
                aria-describedby={fieldError?.field === "when" ? "reminder-field-error" : undefined}
                onChange={(event) => {
                  setWhen(event.target.value);
                  if (fieldError?.field === "when") setFieldError(null);
                }}
              />
            </label>
            <div className="chips" role="group" aria-label="Atajos de hora">
              {shortcuts.map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setWhen(shortcut.value());
                    if (fieldError?.field === "when") setFieldError(null);
                  }}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
          {fieldError?.field === "when" && (
            <p id="reminder-field-error" className="field-error">
              {fieldError.message}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="primary" aria-busy={saving}>
              {saving ? "Guardando…" : "Crear recordatorio"}
            </button>
            <button type="button" className="secondary" onClick={closeForm}>
              Cancelar
            </button>
          </div>
          {formError && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
        </form>
      )}

      {/* La región de aviso existe siempre para que el lector de pantalla anuncie el aviso al aparecer. */}
      <div role="status">
        {undoable && (
          <div ref={toastRef} className="toast">
            <span>Recordatorio borrado</span>
            <button ref={undoRef} type="button" className="toast-action" onClick={undoDelete}>
              Deshacer
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
