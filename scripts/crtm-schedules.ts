// Genera supabase/functions/_shared/crtm-schedules.json con los horarios programados de unas líneas interurbanas.
// El GTFS del CRTM pesa 76 MB y no cabe en una consulta: se extrae aquí lo que se usa y se guarda en el repositorio.
//
// Uso (con el GTFS descomprimido en una carpeta):
//   curl -o m89.zip https://www.arcgis.com/sharing/rest/content/items/885399f83408473c8d815e40c5e702b7/data
//   unzip m89.zip routes.txt trips.txt calendar.txt calendar_dates.txt stops.txt stop_times.txt -d gtfs
//   deno run --allow-read --allow-write scripts/crtm-schedules.ts gtfs 627 N907
import { TextLineStream } from "jsr:@std/streams@1.0.9/text-line-stream";

const [dir, ...lines] = Deno.args;
if (!dir || lines.length === 0) throw new Error("Uso: crtm-schedules.ts <carpeta del GTFS> <línea> [línea…]");

async function* rows(file: string): AsyncGenerator<Record<string, string>> {
  const input = await Deno.open(`${dir}/${file}`);
  let header: string[] | null = null;
  for await (const line of input.readable.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream())) {
    // Los ficheros del CRTM no llevan comillas ni comas dentro de los campos que se usan aquí.
    const cells = line.replace(/^﻿/, "").split(",");
    if (!header) header = cells;
    else yield Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""]));
  }
}

const isoDate = (gtfs: string) => `${gtfs.slice(0, 4)}-${gtfs.slice(4, 6)}-${gtfs.slice(6, 8)}`;
const stopCode = (stopId: string) => stopId.replace(/^par_8_/, "");

const routeLine = new Map<string, string>();
for await (const route of rows("routes.txt")) {
  if (lines.includes(route.route_short_name)) routeLine.set(route.route_id, route.route_short_name);
}
const tripInfo = new Map<string, { line: string; service: string; headsign: string }>();
for await (const trip of rows("trips.txt")) {
  const line = routeLine.get(trip.route_id);
  if (line) tripInfo.set(trip.trip_id, { line, service: trip.service_id, headsign: trip.trip_headsign });
}
const services = new Map<string, { days: number[]; start: string; end: string; added: string[]; removed: string[] }>();
const usedServices = new Set([...tripInfo.values()].map((trip) => trip.service));
for await (const row of rows("calendar.txt")) {
  if (!usedServices.has(row.service_id)) continue;
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) =>
    Number(row[d])
  );
  services.set(row.service_id, {
    days,
    start: isoDate(row.start_date),
    end: isoDate(row.end_date),
    added: [],
    removed: [],
  });
}
for await (const row of rows("calendar_dates.txt")) {
  const service = services.get(row.service_id);
  if (service) (row.exception_type === "1" ? service.added : service.removed).push(isoDate(row.date));
}
const trips = new Map<string, { line: string; service: string; headsign: string; times: Record<string, string> }>();
const usedStops = new Set<string>();
for await (const row of rows("stop_times.txt")) {
  const info = tripInfo.get(row.trip_id);
  if (!info) continue;
  const trip = trips.get(row.trip_id) ?? { ...info, times: {} };
  trip.times[stopCode(row.stop_id)] = row.departure_time.slice(0, 5);
  trips.set(row.trip_id, trip);
  usedStops.add(stopCode(row.stop_id));
}
const stops: Record<string, string> = {};
for await (const stop of rows("stops.txt")) {
  const code = stopCode(stop.stop_id);
  if (usedStops.has(code)) stops[code] = stop.stop_name.trim();
}

const output = {
  source: "GTFS Red de Autobuses Interurbanos del CRTM (datos.crtm.es)",
  generatedOn: new Date().toISOString().slice(0, 10),
  stops,
  services: Object.fromEntries(services),
  trips: [...trips.values()].map(({ line, service, headsign, times }) => ({ line, service, headsign, times })),
};
await Deno.writeTextFile("supabase/functions/_shared/crtm-schedules.json", JSON.stringify(output) + "\n");
console.log(`${output.trips.length} viajes, ${Object.keys(stops).length} paradas, ${services.size} calendarios.`);
