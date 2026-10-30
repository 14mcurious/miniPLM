import { defineConfig, loadEnv } from "vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    root: ".",
    build: {
      outDir: "web",
      rollupOptions: {
        onwarn(warning, warn) {
          // Ignore "use client" directive warnings from React Server Components libraries
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
            return;
          }
          warn(warning);
        }
      }
    },
    server: {
      proxy: {
        "/api/my": {
          target: env.OPS_HOST || env.OPSDEV_HOST,
          changeOrigin: true
        }
      },
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `mammoth` (Word import for HTML fields) requires Node built-ins at
      // module load. They are only used for external file access, which is
      // disabled and unreachable in the browser, so point them at no-op
      // shims to keep the bundle browser-safe.
      fs: path.resolve(__dirname, "./src/shims/node-fs.js"),
      path: path.resolve(__dirname, "./src/shims/node-path.js"),
      url: path.resolve(__dirname, "./src/shims/node-url.js"),
      os: path.resolve(__dirname, "./src/shims/node-os.js"),
    },
  },
};
});
