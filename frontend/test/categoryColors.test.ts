import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryColorClass } from "../src/categoryColors.ts";

test("cada categoría tiene siempre su color, sin depender del orden de la lista", () => {
  assert.equal(categoryColorClass("Supermercado"), "category-1");
  assert.equal(categoryColorClass("Compras"), "category-8");
});

test("Otros y las categorías desconocidas van en gris", () => {
  assert.equal(categoryColorClass("Otros"), "category-other");
  assert.equal(categoryColorClass("Viajes"), "category-other");
  assert.equal(categoryColorClass("toString"), "category-other");
});
