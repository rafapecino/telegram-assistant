import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  askHabits,
  currentStreak,
  doneLastWeek,
  formatHabitList,
  habitButtons,
  parseHabitButton,
  parseHabitRequest,
  recordHabit,
} from "./habits.ts";
import { describeRequests, fakeDb, withTelegram } from "./testing.ts";

const TODAY = "2026-10-22";

function checks(dates: Record<string, boolean>, habitId = 1) {
  return Object.entries(dates).map(([date, done]) => ({ habit_id: habitId, date, done }));
}

Deno.test("entiende crear, apuntar, ver y borrar hábitos", () => {
  assertEquals(parseHabitRequest({ action: "create", name: " leer " }), { kind: "habit_create", name: "Leer" });
  assertEquals(parseHabitRequest({ action: "log", name: "leer", done: true }), {
    kind: "habit_log",
    name: "Leer",
    done: true,
  });
  assertEquals(parseHabitRequest({ action: "list" }), { kind: "habit_list" });
  assertEquals(parseHabitRequest({ action: "delete", name: "leer" }).kind, "habit_delete");
  // Sin saber si lo ha hecho no se apunta nada.
  assertEquals(parseHabitRequest({ action: "log", name: "leer", done: null }).kind, "invalid");
  assertEquals(parseHabitRequest({ action: "create", name: "" }).kind, "invalid");
});

Deno.test("la racha cuenta días seguidos y no se rompe si hoy aún no se ha contestado", () => {
  const history = { "2026-10-19": true, "2026-10-20": true, "2026-10-21": true };
  assertEquals(currentStreak(checks(history), TODAY), 3);
  assertEquals(currentStreak(checks({ ...history, [TODAY]: true }), TODAY), 4);
  assertEquals(currentStreak(checks({ ...history, [TODAY]: false }), TODAY), 0);
  // Un día sin hacer corta la racha.
  assertEquals(currentStreak(checks({ "2026-10-19": true, "2026-10-20": false, "2026-10-21": true }), TODAY), 1);
});

Deno.test("cuenta los días cumplidos de la última semana, hoy incluido", () => {
  const history = { "2026-10-15": true, "2026-10-16": true, "2026-10-20": false, [TODAY]: true };
  assertEquals(doneLastWeek(checks(history), TODAY), 2);
});

Deno.test("los botones llevan el hábito y el día en que se preguntó", () => {
  const [[yes, no]] = habitButtons(7, TODAY);
  assertEquals(parseHabitButton(yes.callback_data), { habitId: 7, date: TODAY, done: true });
  assertEquals(parseHabitButton(no.callback_data), { habitId: 7, date: TODAY, done: false });
  assertEquals(parseHabitButton("shop:done:7"), null);
});

Deno.test("apuntar un hábito guarda el día y devuelve la racha", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("habit_checks")' && query[1].startsWith("select(")
      ? { data: [...checks({ "2026-10-21": true, [TODAY]: true }), ...checks({ [TODAY]: true }, 2)] }
      : {}
  );
  assertEquals(await recordHabit(db, { id: 1, name: "Leer" }, TODAY, true), 2);
  assertEquals(queries[0][1].startsWith('upsert({"habit_id":1,"date":"2026-10-22","done":true'), true);
});

Deno.test("a las 21:00 solo pregunta por los hábitos que no se han apuntado hoy", async () => {
  const { db } = fakeDb((query) => {
    if (query[0] === 'from("habits")') return { data: [{ id: 1, name: "Leer" }, { id: 2, name: "Correr" }] };
    return { data: checks({ [TODAY]: true }, 1) };
  });
  await withTelegram(async (requests) => {
    assertEquals(await askHabits(db, new Date("2026-10-22T19:00:00Z")), 1);
    assertEquals(describeRequests(requests), ["POST /bottoken-de-prueba/sendMessage"]);
    const body = await requests[0].json();
    assertEquals(body.text, "¿Has hecho «Correr» hoy?");
    assertEquals(body.reply_markup.inline_keyboard[0][0].callback_data, `habit:yes:2:${TODAY}`);
  });
});

Deno.test("sin hábitos no pregunta nada", async () => {
  const { db } = fakeDb(() => ({ data: [] }));
  await withTelegram(async (requests) => {
    assertEquals(await askHabits(db, new Date("2026-10-22T19:00:00Z")), 0);
    assertEquals(requests.length, 0);
  });
});

Deno.test("la lista de hábitos enseña racha y semana de cada uno", () => {
  const text = formatHabitList(
    [{ id: 1, name: "Leer" }, { id: 2, name: "Correr" }],
    [...checks({ "2026-10-21": true }), ...checks({ "2026-10-21": false }, 2)],
    TODAY,
  );
  assertEquals(text.split("\n"), [
    "Tus hábitos (te pregunto los días elegidos a las 21:00):",
    "• Leer: racha de 1 día · 1 de 7 días previstos esta semana",
    "• Correr: racha de 0 días · 0 de 7 días previstos esta semana",
  ]);
  assertEquals(formatHabitList([], [], TODAY), "No sigues ningún hábito. Prueba con «quiero leer cada día».");
});
