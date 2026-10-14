import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const contractPath = path.join(projectRoot, "contracts", "VaultEscrow.sol");
const artifactDir = path.join(projectRoot, "artifacts");

if (!fs.existsSync(contractPath)) {
  throw new Error(`Contract not found at ${contractPath}`);
}

const findImports = (importPath) => {
  const directPath = path.resolve(projectRoot, importPath);
  if (fs.existsSync(directPath)) {
    return { contents: fs.readFileSync(directPath, "utf8") };
  }

  const nodeModulePath = path.resolve(projectRoot, "node_modules", importPath);
  if (fs.existsSync(nodeModulePath)) {
    return { contents: fs.readFileSync(nodeModulePath, "utf8") };
  }

  return { error: `Import not found: ${importPath}` };
};

const input = {
  language: "Solidity",
  sources: {
    "VaultEscrow.sol": { content: fs.readFileSync(contractPath, "utf8") },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "metadata"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const contractOutput = output.contracts["VaultEscrow.sol"].VaultEscrow;

if (!contractOutput || !contractOutput.evm || !contractOutput.evm.bytecode || !contractOutput.evm.bytecode.object) {
  const errors = output.errors || [];
  const message = errors
    .filter((e) => e.severity === "error")
    .map((e) => e.formattedMessage || e.message)
    .join("\n");
  throw new Error(message || "Contract compilation failed without details.");
}

fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(
  path.join(artifactDir, "VaultEscrow.json"),
  JSON.stringify(
    {
      abi: contractOutput.abi,
      bytecode: `0x${contractOutput.evm.bytecode.object}`,
      metadata: contractOutput.metadata,
      contractName: "VaultEscrow",
      compilerVersion: output.version || "solc",
    },
    null,
    2,
  ),
);

console.log(`Compiled VaultEscrow.sol successfully to ${path.join(artifactDir, "VaultEscrow.json")}`);
