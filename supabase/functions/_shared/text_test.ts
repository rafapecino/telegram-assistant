import { assertEquals } from "jsr:@std/assert@1.0.19";
import { cleanTextList, comparable, matchByName, tidyName } from "./text.ts";

Deno.test("los nombres se guardan con mayúscula inicial y sin espacios de más", () => {
  assertEquals(tidyName("  mamá   de Juan "), "Mamá de Juan");
});

Deno.test("al comparar no importan mayúsculas, tildes ni espacios", () => {
  assertEquals(comparable(" Plátanos  Canarios"), "platanos canarios");
});

Deno.test("busca por nombre: exacto primero, parcial solo si hay un único candidato", () => {
  const habits = [{ name: "Ejercicio" }, { name: "Leer" }, { name: "Leer en inglés" }];
  assertEquals(matchByName(habits, "ejercicio")?.name, "Ejercicio");
  assertEquals(matchByName(habits, "hacer ejercicio")?.name, "Ejercicio");
  assertEquals(matchByName(habits, "leer")?.name, "Leer");
  assertEquals(matchByName(habits, "inglés")?.name, "Leer en inglés");
  assertEquals(matchByName([{ name: "Leer novelas" }, { name: "Leer prensa" }], "leer"), null);
  assertEquals(matchByName(habits, "meditar"), null);
});

Deno.test("las listas que manda la IA se limpian: sin vacíos, sin repetidos y recortadas", () => {
  assertEquals(cleanTextList(["leche", " Leche ", "", 3, "pan integral de molde"], 9), ["leche", "pan integ"]);
  assertEquals(cleanTextList("leche", 10), []);
});
