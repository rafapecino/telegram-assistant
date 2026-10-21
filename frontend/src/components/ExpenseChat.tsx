import { type FormEvent, useEffect, useRef, useState } from "react";
import { type ExpenseQueryResult, askAboutExpenses, errorText } from "../api";
import { categoryColorClass } from "../categoryColors";
import { formatDay, formatEuros } from "../format";
import { type CategoryShare, categoryShares } from "../stats";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  result?: ExpenseQueryResult | null;
  isError?: boolean;
}

/** Preguntas anteriores que se envían para entender referencias como "¿y el mes pasado?". */
const CONTEXT_QUESTIONS = 4;

const SUGGESTIONS = [
  "¿Cuánto he gastado este mes?",
  "¿Cuánto llevo en restaurantes esta semana?",
  "¿Cuál fue mi gasto más grande del mes?",
  "¿Qué gasté ayer?",
];

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3 10h12M10 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Barra apilada con el reparto por categoría y su leyenda (nombre, importe y %). */
function CategoryMix({ shares }: { shares: CategoryShare[] }) {
  return (
    <div className="mix">
      <div className="mix-bar" aria-hidden="true">
        {shares.map(({ category, amount }) => (
          <span key={category} className={`mix-segment ${categoryColorClass(category)}`} style={{ flexGrow: amount }} />
        ))}
      </div>
      <ul className="mix-legend">
        {shares.map(({ category, amount, percent }) => (
          <li key={category} className={categoryColorClass(category)}>
            <span className="dot" aria-hidden="true" />
            {category} <span className="number">{formatEuros(amount)}</span>
            <span className="muted"> · {percent}&nbsp;%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerDetail({ result }: { result: ExpenseQueryResult }) {
  const shares = categoryShares(result.by_category, result.total);
  return (
    <>
      {shares.length > 1 && <CategoryMix shares={shares} />}
      <ul className="answer-expenses">
        {result.expenses.map((expense) => (
          <li key={expense.id} className={categoryColorClass(expense.category)}>
            <span className="dot" aria-hidden="true" />
            <span className="answer-description">
              {expense.description}
              <span className="muted">
                {" "}
                · {formatDay(expense.booking_date)}
                {/* Si la pregunta era de una categoría, todas son iguales y no se repite. */}
                {!result.category && ` · ${expense.category}`}
              </span>
            </span>
            <span className="number">{formatEuros(expense.amount)}</span>
          </li>
        ))}
      </ul>
      {result.unlisted_count > 0 && <p className="muted answer-more">y {result.unlisted_count} más</p>}
    </>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") return <div className="bubble bubble-user">{message.text}</div>;
  return (
    <div className={message.isError ? "bubble bubble-assistant bubble-error" : "bubble bubble-assistant"}>
      <p>{message.text}</p>
      {message.result && message.result.count > 0 && <AnswerDetail result={message.result} />}
    </div>
  );
}

/** Chat para preguntar por los gastos en lenguaje normal. Las cifras las calcula la API, no la IA. */
export function ExpenseChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isSending, setIsSending] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // La última pregunta sube arriba del chat (sin mover la página), así su respuesta se lee desde el principio:
  // el titular y el reparto van antes de la lista, que puede ser larga.
  useEffect(() => {
    const log = logRef.current;
    const questions = log?.querySelectorAll<HTMLElement>(".bubble-user");
    const lastQuestion = questions?.[questions.length - 1];
    if (log && lastQuestion) log.scrollTop = lastQuestion.offsetTop;
  }, [messages, isSending]);

  function addMessage(message: Omit<ChatMessage, "id">) {
    const id = nextId.current++;
    setMessages((current) => [...current, { ...message, id }]);
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      inputRef.current?.focus();
      return;
    }
    const previousQuestions = messages
      .filter((message) => message.role === "user")
      .slice(-CONTEXT_QUESTIONS)
      .map((message) => message.text);
    addMessage({ role: "user", text: trimmed });
    setQuestion("");
    setIsSending(true);
    try {
      const answer = await askAboutExpenses(trimmed, previousQuestions);
      addMessage({ role: "assistant", text: answer.text, result: answer.result });
    } catch (failure) {
      addMessage({ role: "assistant", text: `No he podido responder: ${errorText(failure)}`, isError: true });
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  function startOver() {
    setMessages([]);
    inputRef.current?.focus();
  }

  return (
    <section className="card chat-card" aria-labelledby="chat-title">
      <div className="card-header">
        <h2 id="chat-title">Pregunta por tus gastos</h2>
        {messages.length > 0 && (
          <button type="button" className="link-button" onClick={startOver}>
            Nueva conversación
          </button>
        )}
      </div>

      <div ref={logRef} className="chat-log" role="log" aria-label="Conversación" tabIndex={0}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p className="muted">Pregunta como hablarías: periodos, categorías, comercios o tus gastos más grandes.</p>
            <div className="chips" role="group" aria-label="Preguntas de ejemplo">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="chip" onClick={() => void ask(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <ChatBubble key={message.id} message={message} />)
        )}
        {isSending && <p className="bubble bubble-assistant typing">Pensando…</p>}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor="chat-question">
          Tu pregunta
        </label>
        <input
          id="chat-question"
          ref={inputRef}
          type="text"
          value={question}
          maxLength={300}
          autoComplete="off"
          placeholder="¿Cuánto llevo en Mercadona?"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" className="send-button" aria-label="Enviar pregunta" aria-busy={isSending}>
          <SendIcon />
        </button>
      </form>
    </section>
  );
}
