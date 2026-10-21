import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = "http://localhost:8000";

// En desarrollo, las rutas de datos se reenvían a FastAPI. En producción la propia API sirve la web compilada
// (frontend/dist), así que las rutas son las mismas y no hace falta CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/expenses": API,
      "/reminders": API,
      "/health": API,
    },
  },
});
