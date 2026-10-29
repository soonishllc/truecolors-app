import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { payoutMethods, type PayoutMethodKind } from "../db/schema";
import { UserError } from "../design/service";

// Where each designer wants their earnings: PayPal, a bank transfer, or USDC to a wallet. Payouts are still
// sent by hand from the admin page; the details are encrypted at rest and only ever shown in full to admins.

export type PaypalDetails = { email: string };
export type BankDetails = { holder: string; country: string; bankName: string; iban?: string; accountNumber?: string; routing?: string; swift?: string };
export type UsdcDetails = { network: UsdcNetwork; address: string };
export type PayoutDetails = PaypalDetails | BankDetails | UsdcDetails;

export const USDC_NETWORKS = { base: "Base", solana: "Solana", ethereum: "Ethereum", polygon: "Polygon" } as const;
export type UsdcNetwork = keyof typeof USDC_NETWORKS;

function key() {
  const { PAYOUT_ENCRYPTION_KEY, SESSION_SECRET, APP_URL } = config();
  if (!PAYOUT_ENCRYPTION_KEY && APP_URL.startsWith("https")) throw new Error("Set PAYOUT_ENCRYPTION_KEY before taking payout details");
  return createHash("sha256").update(PAYOUT_ENCRYPTION_KEY ?? `dev-payouts:${SESSION_SECRET}`).digest();
}

export function encrypt(data: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt<T>(value: string): T {
  const raw = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
}

const tail = (s: string, n = 4) => `•••• ${s.slice(-n)}`;
const compactNum = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

// IBANs carry a mod-97 checksum, which catches almost every typo.
export function validIban(input: string) {
  const iban = compactNum(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

export function validWallet(network: UsdcNetwork, address: string) {
  return network === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : /^0x[0-9a-fA-F]{40}$/.test(address);
}

// Checks what the designer typed and returns the details to store plus the masked line to show them.
export function parsePayoutMethod(kind: string, f: Record<string, string>): { kind: PayoutMethodKind; details: PayoutDetails; summary: string } {
  if (kind === "paypal") {
    const email = (f.paypalEmail ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter the email address of your PayPal account.");
    const [name, domain] = email.split("@");
    return { kind, details: { email }, summary: `PayPal · ${name.slice(0, 2)}•••@${domain}` };
  }
  if (kind === "bank") {
    const holder = (f.holder ?? "").trim();
    const country = (f.country ?? "").trim().toUpperCase();
    const bankName = (f.bankName ?? "").trim();
    if (!holder || !bankName) throw new UserError("Add the account holder's name and the bank's name.");
    if (!/^[A-Z]{2}$/.test(country)) throw new UserError("Pick the bank's country.");
    if (country === "US") {
      const accountNumber = compactNum(f.accountNumber ?? "");
      const routing = compactNum(f.routing ?? "");
      if (!/^\d{4,17}$/.test(accountNumber) || !/^\d{9}$/.test(routing)) throw new UserError("Add a US account number and the 9-digit routing number.");
      return { kind, details: { holder, country, bankName, accountNumber, routing }, summary: `Bank · ${bankName} ${tail(accountNumber)}` };
    }
    const iban = compactNum(f.iban ?? "");
    const swift = compactNum(f.swift ?? "");
    if (!validIban(iban)) throw new UserError("That IBAN doesn't look right. Check it against your bank statement.");
    if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) throw new UserError("Add the bank's SWIFT/BIC code (8 or 11 characters).");
    return { kind, details: { holder, country, bankName, iban, swift }, summary: `Bank · ${bankName} ${iban.slice(0, 2)} ${tail(iban)}` };
  }
  if (kind === "usdc") {
    const network = f.network as UsdcNetwork;
    const address = (f.address ?? "").trim();
    if (!(network in USDC_NETWORKS)) throw new UserError("Pick the network your wallet uses.");
    if (!validWallet(network, address)) throw new UserError(`That isn't a valid ${USDC_NETWORKS[network]} wallet address.`);
    return { kind, details: { network, address }, summary: `USDC on ${USDC_NETWORKS[network]} · ${address.slice(0, 6)}…${address.slice(-4)}` };
  }
  throw new UserError("Pick how you'd like to be paid.");
}

export async function savePayoutMethod(userId: string, kind: string, form: Record<string, string>) {
  const parsed = parsePayoutMethod(kind, form);
  const d = await db();
  const row = { kind: parsed.kind, details: encrypt(parsed.details), summary: parsed.summary, updatedAt: new Date() };
  await d.insert(payoutMethods).values({ userId, ...row }).onConflictDoUpdate({ target: payoutMethods.userId, set: row });
  return parsed.summary;
}

// What the designer sees: the kind and the masked summary, never the full details.
export async function payoutMethod(userId: string) {
  const d = await db();
  const [m] = await d.select({ kind: payoutMethods.kind, summary: payoutMethods.summary, updatedAt: payoutMethods.updatedAt })
    .from(payoutMethods).where(eq(payoutMethods.userId, userId));
  return m;
}

// Admins only: the full details, to send a payout by hand.
export async function payoutDetailsForAdmin(userId: string) {
  const d = await db();
  const [m] = await d.select().from(payoutMethods).where(eq(payoutMethods.userId, userId));
  return m && { kind: m.kind, details: decrypt<PayoutDetails>(m.details) };
}
