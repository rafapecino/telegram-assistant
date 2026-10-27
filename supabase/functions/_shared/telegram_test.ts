import { assertRejects } from "jsr:@std/assert@1.0.19";
import { editTelegramMessage } from "./telegram.ts";
import { TELEGRAM_ENV, withFakeFetch } from "./testing.ts";

const telegramRejecting = (description: string) => () => Response.json({ ok: false, description }, { status: 400 });

Deno.test("si el mensaje ya está igual (botón pulsado dos veces), editarlo no es un error", async () => {
  const description = "Bad Request: message is not modified: specified new message content and reply markup are " +
    "exactly the same as a current content and reply markup of the message";
  await withFakeFetch(TELEGRAM_ENV, telegramRejecting(description), async () => {
    await editTelegramMessage(7, "Lista vacía");
  });
});

Deno.test("cualquier otro rechazo al editar sigue siendo un error", async () => {
  await withFakeFetch(TELEGRAM_ENV, telegramRejecting("Bad Request: message to edit not found"), async () => {
    await assertRejects(() => editTelegramMessage(7, "Lista vacía"), Error, "message to edit not found");
  });
});
