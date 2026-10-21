import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReminderForm } from "../src/validation.ts";

const NOW = "2026-10-21T12:00";

test("sin texto pide escribirlo, aunque solo haya espacios", () => {
  const error = { field: "text", message: "Escribe qué quieres que te recuerde" };
  assert.deepEqual(validateReminderForm("", "2026-10-22T09:00", NOW), error);
  assert.deepEqual(validateReminderForm("   ", "2026-10-22T09:00", NOW), error);
});

test("sin fecha o con una fecha pasada señala el campo de la hora", () => {
  assert.equal(validateReminderForm("Llamar", "", NOW)?.field, "when");
  assert.equal(validateReminderForm("Llamar", "2026-10-21T12:00", NOW)?.field, "when");
  assert.equal(validateReminderForm("Llamar", "2026-10-20T09:00", NOW)?.field, "when");
});

test("con texto y una fecha futura es válido", () => {
  assert.equal(validateReminderForm("Llamar a Juan", "2026-10-21T12:01", NOW), null);
});
