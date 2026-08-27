import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Server code reads `process.env`, and Vite only exposes `VITE_`-prefixed
  // values on `import.meta.env`. Copy the rest across for dev, without letting
  // a stale .env override what the real environment already set.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
    process.env[key] ??= value;
  }

  return {
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
  };
});
