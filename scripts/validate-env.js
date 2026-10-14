import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
const examplePath = path.join(projectRoot, ".env.example");

const required = [
  "VITE_MONAD_CHAIN_ID",
  "VITE_MONAD_RPC_URL",
  "VITE_VAULT_ADDRESS",
];

const exampleText = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";
const localEnvText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

const env = Object.fromEntries(
  [...localEnvText.split(/\r?\n/), ...Object.entries(process.env).map(([k, v]) => `${k}=${v}`)]
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const missing = required.filter((key) => !env[key] || env[key].trim() === "");
const warnings = [];

if (missing.length) {
  warnings.push(`Missing frontend env values: ${missing.join(", ")}. Set them in .env before running the app.`);
}

if (!exampleText.includes("VITE_MONAD_CHAIN_ID") || !exampleText.includes("VITE_MONAD_RPC_URL") || !exampleText.includes("VITE_VAULT_ADDRESS")) {
  warnings.push(".env.example is missing the documented Monad Testnet configuration keys.");
}

if (warnings.length) {
  console.log("Warnings:");
  warnings.forEach((warning) => console.log(`- ${warning}`));
  process.exitCode = 1;
} else {
  console.log("Frontend configuration looks complete.");
}
