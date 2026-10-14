import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const artifactPath = path.join(projectRoot, "artifacts", "VaultEscrow.json");

if (!fs.existsSync(artifactPath)) {
  throw new Error(`Compiled artifact not found at ${artifactPath}. Run "npm run compile:contract" first.`);
}

const rpcUrl = process.env.MONAD_RPC_URL || process.env.VITE_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const expectedChainId = Number(process.env.MONAD_CHAIN_ID || process.env.VITE_MONAD_CHAIN_ID || "10143");
const privateKey = process.env.MONAD_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

if (!privateKey) {
  throw new Error("Set MONAD_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in your local environment before deploying.");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
const chainId = Number(network.chainId);
if (chainId !== expectedChainId) {
  throw new Error(`RPC returned chainId ${chainId}, expected ${expectedChainId}. Check MONAD_CHAIN_ID and MONAD_RPC_URL.`);
}

const wallet = new ethers.Wallet(privateKey, provider);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

console.log(`Deploying VaultEscrow from ${wallet.address} on Monad Testnet (chainId ${chainId}) via ${rpcUrl}`);
const contract = await factory.deploy();
await contract.waitForDeployment();

const address = await contract.getAddress();
const txHash = contract.deploymentTransaction() ? contract.deploymentTransaction().hash : null;
const receipt = txHash ? await provider.getTransactionReceipt(txHash) : null;

if (!receipt || receipt.status !== 1) {
  throw new Error(`Deployment transaction failed or did not produce a successful receipt. txHash=${txHash}`);
}

if (!address || !address.startsWith("0x")) {
  throw new Error("Deployed address is missing or invalid.");
}

const bytecode = await provider.getCode(address);
if (!bytecode || bytecode === "0x") {
  throw new Error(`No bytecode exists at ${address}.`);
}

console.log(JSON.stringify(
  {
    chainId,
    deployer: wallet.address,
    contractAddress: address,
    txHash,
    receiptStatus: receipt.status,
    explorerUrl: `https://testnet.monadexplorer.com/tx/${txHash}`,
    bytecodeLength: bytecode.length,
  },
  null,
  2,
));
