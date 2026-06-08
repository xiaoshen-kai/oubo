import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const command = process.argv[2] || "dev";
const args = process.argv.slice(3);
const cwd = process.cwd();
const env = { ...process.env };

const swcWasmDir = join(cwd, "node_modules", "@next", "swc-wasm-nodejs");
if (!env.NEXT_TEST_WASM_DIR && existsSync(swcWasmDir)) {
  env.NEXT_TEST_WASM_DIR = swcWasmDir;
}

if (!env.NEXT_DIST_DIR && (command === "build" || command === "start")) {
  env.NEXT_DIST_DIR = ".next-build";
}

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, command, ...args], {
  cwd,
  env,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
