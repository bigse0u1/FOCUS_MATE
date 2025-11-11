import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      external: ["@mediapipe/face_mesh", "@mediapipe/camera_utils"],
    },
  },
});
