import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  ageOn,
  type Birthday,
  birthdaysOn,
  formatUpcomingBirthdays,
  nextBirthday,
  parseBirthdayRequest,
} from "./birthdays.ts";

const MOM: Birthday = { id: 1, name: "Mamá", month: 3, day: 3, year: 1966 };
const LEAP: Birthday = { id: 2, name: "Luis", month: 2, day: 29, year: null };
const JUAN: Birthday = { id: 3, name: "Juan", month: 10, day: 23, year: null };

Deno.test("entiende guardar, borrar y listar cumpleaños, y acepta el 29 de febrero", () => {
  assertEquals(parseBirthdayRequest({ action: "save", name: "mamá", month: 3, day: 3, year: 1966 }, 2026), {
    kind: "birthday_save",
    name: "Mamá",
    month: 3,
    day: 3,
    year: 1966,
  });
  assertEquals(
    parseBirthdayRequest({ action: "save", name: "Luis", month: 2, day: 29, year: null }, 2026).kind,
    "birthday_save",
  );
  assertEquals(parseBirthdayRequest({ action: "delete", name: "Luis" }, 2026), {
    kind: "birthday_delete",
    name: "Luis",
  });
  assertEquals(parseBirthdayRequest({ action: "list" }, 2026), { kind: "birthday_list" });
});

Deno.test("rechaza fechas imposibles y años de nacimiento futuros", () => {
  assertEquals(parseBirthdayRequest({ action: "save", name: "X", month: 2, day: 30 }, 2026).kind, "invalid");
  assertEquals(parseBirthdayRequest({ action: "save", name: "X", month: 13, day: 1 }, 2026).kind, "invalid");
  assertEquals(parseBirthdayRequest({ action: "save", name: "X", month: 1, day: 1, year: 2030 }, 2026).kind, "invalid");
  assertEquals(parseBirthdayRequest({ action: "save", name: " ", month: 1, day: 1 }, 2026).kind, "invalid");
});

Deno.test("el próximo cumpleaños incluye hoy y, si ya pasó, es el del año que viene", () => {
  assertEquals(nextBirthday(JUAN, "2026-10-23"), "2026-10-23");
  assertEquals(nextBirthday(MOM, "2026-10-22"), "2027-03-03");
});

Deno.test("quien nació el 29 de febrero lo celebra el 28 los años no bisiestos", () => {
  assertEquals(nextBirthday(LEAP, "2026-10-22"), "2027-02-28");
  assertEquals(nextBirthday(LEAP, "2027-03-01"), "2028-02-29");
  assertEquals(birthdaysOn([LEAP], "2027-02-28"), [LEAP]);
  assertEquals(birthdaysOn([LEAP], "2028-02-28"), []);
});

Deno.test("calcula la edad solo si se sabe el año", () => {
  assertEquals(ageOn(MOM, "2027-03-03"), 61);
  assertEquals(ageOn(JUAN, "2026-10-23"), null);
});

Deno.test("la lista va del más cercano al más lejano y dice cuánto falta", () => {
  assertEquals(
    formatUpcomingBirthdays([MOM, JUAN, LEAP], "2026-10-22"),
    [
      "Próximos cumpleaños:",
      "• Juan: 23 de octubre, mañana",
      "• Luis: 29 de febrero, en 129 días",
      "• Mamá (61): 3 de marzo, en 132 días",
    ].join("\n"),
  );
});
