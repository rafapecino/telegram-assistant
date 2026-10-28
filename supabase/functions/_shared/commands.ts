// Comandos con barra (/ayuda, /conectar_banco…). Funcionan igual en Telegram y en el chat del panel.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  describeBankLink,
  describeGoogleLink,
  disconnectBankAndDescribe,
  disconnectGoogleAndDescribe,
} from "./connections.ts";

export const HELP_TEXT = [
  "Esto es lo que sé hacer:",
  '• Recordatorios: "recuérdame llamar a Juan el jueves a las 17:00" o "cada lunes a las 9 sacar la basura".',
  '• Consultar tus gastos: "¿cuánto he gastado esta semana?" o "gastos de ayer en restaurantes".',
  '• Presupuestos: "pon un límite de 200 € al mes en restaurantes" o "¿cómo voy con los presupuestos?".',
  '• Balance: "¿cuánto he ahorrado este mes?".',
  '• Lista de la compra: "añade leche y pan a la compra" o "¿qué hay en la lista?".',
  '• Notas: "apunta que la talla de Marta es la 38" y luego "¿qué talla usa Marta?".',
  '• Cumpleaños: "el cumple de mamá es el 3 de marzo". Te aviso el día antes y el mismo día.',
  '• Hábitos: "quiero leer cada día". Te pregunto cada noche a las 21:00.',
  '• Calendario: "¿qué tengo mañana?" o "pon en el calendario dentista el martes a las 10".',
  '• Correo: "¿tengo correos sin leer?" o "¿me ha escrito Hacienda?". Solo leo remitente, asunto y fecha.',
  '• Filtros del correo: "no me enseñes los correos de Uber", "vuelve a enseñarme los de Uber" o "¿qué filtras?".',
  '• Autobús EMT: "la parada de casa es la 1234" y luego "¿cuándo pasa el bus de casa?".',
  "• Avisos de AEMET para Madrid: te escribo cuando sale uno nuevo y salen en el resumen de la mañana.",
  '• Mercados: "¿cómo va el bitcoin?", "¿cómo van los mercados?", "sigue AMD" o "deja de seguir Tesla".',
  '• Precios: "¿dónde está más barata la PS5?" o "avísame si la PS5 baja de 400 €". Miro cada día a las 10:00.',
  "• Cada día a las 8:00 te mando un resumen: tiempo, avisos, recordatorios, calendario, correo, cumpleaños y una " +
  "curiosidad de un día como hoy.",
  "• También me puedes mandar notas de voz.",
  '• Conexiones: "conecta el banco", "vuelve a conectar Google" o "desconecta el banco". Google da el calendario y ' +
  "Gmail; el banco importa los gastos cada día a las 8:00.",
  "• También con comandos: /conectar_banco, /desconectar_banco, /conectar_calendario y /desconectar_calendario.",
  "• Los domingos a las 20:00 te mando el resumen de gastos de la semana.",
].join("\n");

/** La respuesta a un comando, o null si el texto no es ninguno. Los comandos actúan sin pedir confirmación. */
export async function replyToCommand(db: SupabaseClient, text: string, now: Date): Promise<string | null> {
  switch (text.trim().toLowerCase()) {
    case "/start":
    case "/ayuda":
      return HELP_TEXT;
    case "/conectar_banco":
      return await describeBankLink(db, now);
    case "/desconectar_banco":
      return await disconnectBankAndDescribe(db, now);
    case "/conectar_calendario":
      return await describeGoogleLink(db);
    case "/desconectar_calendario":
      return await disconnectGoogleAndDescribe(db);
    default:
      return null;
  }
}
