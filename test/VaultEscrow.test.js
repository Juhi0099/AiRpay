import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(projectRoot, "contracts", "VaultEscrow.sol");
const source = fs.readFileSync(contractPath, "utf8");
const compilation = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "VaultEscrow.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);
const contractOutput = compilation.contracts?.["VaultEscrow.sol"]?.VaultEscrow;

if (!contractOutput?.evm?.bytecode?.object) {
  const errors = (compilation.errors || [])
    .filter((error) => error.severity === "error")
    .map((error) => error.formattedMessage)
    .join("\n");
  throw new Error(errors || "VaultEscrow compilation failed.");
}

const voucherTypes = {
  Voucher: [
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

async function createFixture() {
  const eip1193 = ganache.provider({ chain: { chainId: 10143 }, logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(eip1193);
  const payerKey = Object.values(eip1193.getInitialAccounts())[0].secretKey;
  const payer = new ethers.Wallet(payerKey, provider);
  const merchant = await provider.getSigner(1);
  const factory = new ethers.ContractFactory(contractOutput.abi, contractOutput.evm.bytecode.object, payer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  return { eip1193, provider, payer, merchant, contract };
}

async function signVoucher(fixture, amount, nonce, expiryOverride) {
  const { payer, merchant, contract, provider } = fixture;
  const network = await provider.getNetwork();
  const block = await provider.getBlock("latest");
  const voucher = {
    payer: await payer.getAddress(),
    merchant: await merchant.getAddress(),
    amount,
    nonce,
    expiry: expiryOverride ?? BigInt(block.timestamp + 3600),
  };
  const signature = await payer.signTypedData(
    {
      name: "NoSignalVault",
      version: "1.0.0",
      chainId: network.chainId,
      verifyingContract: await contract.getAddress(),
    },
    voucherTypes,
    voucher,
  );

  return { ...voucher, signature };
}

async function reserveVoucher(fixture, nonce, amount) {
  const block = await fixture.provider.getBlock("latest");
  const expiry = BigInt(block.timestamp + 3600);
  await (await fixture.contract.reserveVoucher(nonce, amount, expiry)).wait();
  return expiry;
}

async function settle(fixture, ...vouchers) {
  return (await fixture.contract.batchSettle(vouchers)).wait();
}

test("settles a signed voucher from its own reservation and preserves other locks", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, merchant, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const merchantAddress = await merchant.getAddress();
  const payment = ethers.parseEther("6");

  await (await contract.deposit({ value: ethers.parseEther("10") })).wait();
  const expiry = await reserveVoucher(fixture, 1n, payment);
  await (await contract.reserveFunds(ethers.parseEther("2"))).wait();
  const voucher = await signVoucher(fixture, payment, 1n, expiry);

  await settle(fixture, voucher);

  assert.equal(await contract.balances(payerAddress), ethers.parseEther("4"));
  assert.equal(await contract.reservedBalance(payerAddress), ethers.parseEther("2"));
  assert.equal(await contract.voucherReservedBalance(payerAddress), 0n);
  assert.equal(await contract.voucherReservation(payerAddress, 1n), 0n);
  assert.equal(await contract.balances(merchantAddress), payment);
  assert.equal(await contract.nonceUsed(payerAddress, 1n), true);
  await assert.rejects(contract.withdraw(ethers.parseEther("2.01"), payerAddress));
});

test("rejects insufficient funds without using the nonce and succeeds after funding/reservation", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const amount = ethers.parseEther("3");

  await (await contract.deposit({ value: ethers.parseEther("2") })).wait();
  const voucher = await signVoucher(fixture, amount, 7n);
  await settle(fixture, voucher);

  assert.equal(await contract.nonceUsed(payerAddress, 7n), false);
  assert.equal(await contract.balances(payerAddress), ethers.parseEther("2"));

  await (await contract.deposit({ value: ethers.parseEther("1") })).wait();
  const expiry = await reserveVoucher(fixture, 7n, amount);
  const reservedVoucher = await signVoucher(fixture, amount, 7n, expiry);
  await settle(fixture, reservedVoucher);

  assert.equal(await contract.nonceUsed(payerAddress, 7n), true);
  assert.equal(await contract.balances(payerAddress), 0n);
});

test("settles duplicate vouchers only once and leaves the second attempt rejected", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, merchant, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const merchantAddress = await merchant.getAddress();
  const amount = ethers.parseEther("4");

  await (await contract.deposit({ value: ethers.parseEther("4") })).wait();
  const expiry = await reserveVoucher(fixture, 8n, amount);
  const voucher = await signVoucher(fixture, amount, 8n, expiry);
  await settle(fixture, voucher, voucher);

  assert.equal(await contract.balances(payerAddress), 0n);
  assert.equal(await contract.balances(merchantAddress), amount);
  assert.equal(await contract.reservedBalance(payerAddress), 0n);
  assert.equal(await contract.nonceUsed(payerAddress, 8n), true);
});

test("rejects expired vouchers without consuming the nonce or reservation", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const amount = ethers.parseEther("2");

  await (await contract.deposit({ value: amount })).wait();
  const voucher = await signVoucher(fixture, amount, 9n, 1n);
  await settle(fixture, voucher);

  assert.equal(await contract.nonceUsed(payerAddress, 9n), false);
  assert.equal(await contract.balances(payerAddress), amount);
});

test("prevents repeated reservations and keeps each voucher backed separately", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const firstAmount = ethers.parseEther("6");
  const secondAmount = ethers.parseEther("4");

  await (await contract.deposit({ value: ethers.parseEther("10") })).wait();
  const firstExpiry = await reserveVoucher(fixture, 10n, firstAmount);
  await assert.rejects(reserveVoucher(fixture, 10n, 1n));
  await assert.rejects(reserveVoucher(fixture, 11n, ethers.parseEther("4.01")));
  await assert.rejects(contract.releaseReservation(1n));
  const secondExpiry = await reserveVoucher(fixture, 11n, secondAmount);

  assert.equal(await contract.reservedBalance(payerAddress), ethers.parseEther("10"));
  assert.equal(await contract.voucherReservedBalance(payerAddress), ethers.parseEther("10"));

  const firstVoucher = await signVoucher(fixture, firstAmount, 10n, firstExpiry);
  await settle(fixture, firstVoucher);

  assert.equal(await contract.reservedBalance(payerAddress), secondAmount);
  assert.equal(await contract.voucherReservation(payerAddress, 11n), secondAmount);
  assert.equal(await contract.voucherReservationExpiry(payerAddress, 11n), secondExpiry);
  assert.equal(await contract.nonceUsed(payerAddress, 11n), false);
});

test("does not consume a mismatched reservation; payer can cancel and cannot reuse its nonce", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const amount = ethers.parseEther("5");

  await (await contract.deposit({ value: amount })).wait();
  const expiry = await reserveVoucher(fixture, 12n, amount);
  const mismatch = await signVoucher(fixture, ethers.parseEther("4"), 12n, expiry);
  await settle(fixture, mismatch);

  assert.equal(await contract.nonceUsed(payerAddress, 12n), false);
  assert.equal(await contract.voucherReservation(payerAddress, 12n), amount);
  await (await contract.cancelVoucherReservation(12n)).wait();
  assert.equal(await contract.nonceUsed(payerAddress, 12n), true);
  assert.equal(await contract.reservedBalance(payerAddress), 0n);
  await assert.rejects(reserveVoucher(fixture, 12n, amount));
});

test("releases an expired reservation once, without allowing a live reservation to be released", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, contract, eip1193 } = fixture;
  const payerAddress = await payer.getAddress();
  const amount = ethers.parseEther("2");

  await (await contract.deposit({ value: amount })).wait();
  const expiry = await reserveVoucher(fixture, 13n, amount);
  await assert.rejects(contract.releaseExpiredVoucherReservation(payerAddress, 13n));

  await eip1193.request({ method: "evm_mine", params: [Number(expiry + 10n)] });
  const latestBlock = await eip1193.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  assert.ok(BigInt(latestBlock.timestamp) > expiry);
  assert.equal(await contract.voucherReservationExpiry(payerAddress, 13n), expiry);
  await contract.releaseExpiredVoucherReservation.staticCall(payerAddress, 13n);
  await (await contract.releaseExpiredVoucherReservation(payerAddress, 13n, { gasLimit: 300000 })).wait();

  assert.equal(await contract.reservedBalance(payerAddress), 0n);
  assert.equal(await contract.voucherReservation(payerAddress, 13n), 0n);
  await assert.rejects(contract.releaseExpiredVoucherReservation(payerAddress, 13n));
});

test("retains EIP-712 verification and rejects an invalid signature without consuming its nonce", async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.eip1193.disconnect());
  const { payer, contract } = fixture;
  const payerAddress = await payer.getAddress();
  const amount = ethers.parseEther("1");

  await (await contract.deposit({ value: amount })).wait();
  const voucher = await signVoucher(fixture, amount, 14n);
  assert.equal(await contract.verifyVoucher(voucher), true);
  const invalidVoucher = { ...voucher, signature: `0x${"00".repeat(65)}` };
  await settle(fixture, invalidVoucher);
  assert.equal(await contract.nonceUsed(payerAddress, 14n), false);
  assert.equal(await contract.balances(payerAddress), amount);

  await settle(fixture, voucher);
  assert.equal(await contract.nonceUsed(payerAddress, 14n), true);
});
