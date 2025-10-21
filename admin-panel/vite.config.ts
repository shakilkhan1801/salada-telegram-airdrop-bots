import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const base = process.env.PUBLIC_BASE?.endsWith("/") ? process.env.PUBLIC_BASE : (process.env.PUBLIC_BASE ? process.env.PUBLIC_BASE + "/" : "/admin/");

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
