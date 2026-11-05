import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { batches, type QuiqupCarton, type QuiqupInbound } from "../db/schema";
import { UserError } from "../design/service";
import { sku, type Size } from "../rules";
import { batchLines, csv, itemName } from "./batch";

// The document set Quiqup (Al Quoz, Dubai) needs for each inbound of UAE pre-orders: the product import CSV,
// the packing list CSV and the commercial invoice, all sent as one reply to Quiqup's inbound calendar invite
// at least 48 hours before the shipment lands. Cartons travel loose on the FedEx air lane from Cancún, so
// every carton goes on pallet "#001", the consignee is "Quiqup", and the barcode is the SKU itself (Code 128).

export const QUIQUP_CONSIGNEE = { name: "Quiqup Delivery LLC", address: "38 – 14B – Warehouse 1, Al Marabea' St, Al Quoz, Dubai, UAE" };
export const UAE_CONSIGNOR = { name: "True Colors Trading LLC", address: "Office 15C-06, Al Ghurair Real Estate LLC, Deira, Al Muteena, Dubai, UAE" };
const SHIRT_WEIGHT_G = 200;
const HS_CODE = "6109.10";
const ORIGIN = "Mexico";
const NOTICE_MS = 48 * 3600_000;

// What Quiqup is expecting, by SKU.
async function quiqupItems(batchId: string) {
  const lines = await batchLines(batchId, "quiqup");
  return lines.map((l) => ({ sku: sku(l.code, l.size as Size), name: itemName(l.title, l.size), ordered: l.qty }));
}

export async function quiqupInbound(batchId: string) {
  const d = await db();
  const [b] = await d.select().from(batches).where(eq(batches.id, batchId));
  return b?.quiqupInbound ?? null;
}

// Cartons are entered one per line, as Cancún reports them: "#BOX 1 | 49x49x34 | 16.03 | TC-AB12-WHT-S=49, TC-CD34-WHT-S=50"
// (box, length × width × height in cm, gross kg, then SKU=quantity for each design in the box).
export function parseCartons(text: string): QuiqupCarton[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [box, dims, kg, contents] = line.split("|").map((p) => p.trim());
    const size = dims?.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i);
    const weightKg = Number(kg);
    if (!box || !size || !(weightKg > 0) || !contents) {
      throw new UserError(`Can't read "${line}". Write each carton as: #BOX 1 | 49x49x34 | 16.03 | SKU=49, SKU=50`);
    }
    const items: Record<string, number> = {};
    for (const part of contents.split(",").map((p) => p.trim()).filter(Boolean)) {
      const [code, qty] = part.split("=").map((p) => p.trim());
      const n = Number(qty);
      if (!code || !Number.isInteger(n) || n <= 0) throw new UserError(`Can't read "${part}" in ${box}. Write it as SKU=quantity.`);
      items[code.toUpperCase()] = (items[code.toUpperCase()] ?? 0) + n;
    }
    return { box, lengthCm: Number(size[1]), widthCm: Number(size[2]), heightCm: Number(size[3]), weightKg, contents: items };
  });
}

export const formatCartons = (cartons: QuiqupCarton[]) =>
  cartons
    .map((c) => `${c.box} | ${c.lengthCm}x${c.widthCm}x${c.heightCm} | ${c.weightKg} | ${Object.entries(c.contents).map(([s, q]) => `${s}=${q}`).join(", ")}`)
    .join("\n");

export async function saveQuiqupInbound(
  batchId: string,
  input: { invoiceNo: string; consignor: string; consignorAddress: string; unitValue: string; arrivesAt: string; cartons: string },
) {
  const { invoiceNo, consignor, consignorAddress } = input;
  if (!invoiceNo || !consignor || !consignorAddress) throw new UserError("Fill in the invoice number and the consignor.");
  const unitValueCents = Math.round(Number(input.unitValue) * 100);
  if (!(unitValueCents > 0)) throw new UserError("Enter the declared value per shirt in USD, e.g. 3.50.");
  // Arrival as FedEx gives it, in Dubai time.
  const arrival = new Date(`${input.arrivesAt}${input.arrivesAt.length === 16 ? ":00" : ""}+04:00`);
  if (!input.arrivesAt || Number.isNaN(arrival.getTime())) throw new UserError("Enter when the shipment arrives at Quiqup.");
  const cartons = parseCartons(input.cartons);
  if (!cartons.length) throw new UserError("List the cartons Cancún packed for Quiqup.");
  const boxes = cartons.map((c) => c.box);
  const repeated = boxes.find((b, i) => boxes.indexOf(b) !== i);
  if (repeated) throw new UserError(`${repeated} is listed twice.`);
  const known = new Set((await quiqupItems(batchId)).map((i) => i.sku));
  for (const c of cartons) {
    const stray = Object.keys(c.contents).find((s) => !known.has(s));
    if (stray) throw new UserError(`${stray} in ${c.box} isn't one of this batch's UAE SKUs.`);
  }
  const inbound: QuiqupInbound = { invoiceNo, consignor, consignorAddress, unitValueCents, arrivesAt: arrival.toISOString(), cartons };
  const d = await db();
  await d.update(batches).set({ quiqupInbound: inbound }).where(eq(batches.id, batchId));
  return inbound;
}

// Everything to check before replying to Quiqup: totals to match against the FedEx master airbill, cartons
// to warn Quiqup's account rep about, and counts that differ from the pre-orders (damaged shirts held back, say).
export async function quiqupReview(batchId: string) {
  const items = await quiqupItems(batchId);
  const inbound = await quiqupInbound(batchId);
  if (!inbound) return { items, inbound: null, shirts: items.reduce((n, i) => n + i.ordered, 0) };
  const packed = packedBySku(inbound.cartons);
  const cartonsOf = (s: string) => inbound.cartons.filter((c) => s in c.contents).length;
  return {
    items,
    inbound,
    shirts: [...packed.values()].reduce((n, q) => n + q, 0),
    kg: Math.round(inbound.cartons.reduce((n, c) => n + c.weightKg, 0) * 100) / 100,
    // Quiqup's SOPs want one SKU per carton and may charge to separate mixed ones; its prep guide allows them
    // as long as no SKU is split across cartons. Either way, Quiqup hears about it before the documents go in.
    mixedBoxes: inbound.cartons.filter((c) => Object.keys(c.contents).length > 1).map((c) => c.box),
    splitSkus: [...packed.keys()].filter((s) => cartonsOf(s) > 1),
    differences: items.filter((i) => (packed.get(i.sku) ?? 0) !== i.ordered).map((i) => ({ ...i, packed: packed.get(i.sku) ?? 0 })),
    deadline: new Date(new Date(inbound.arrivesAt).getTime() - NOTICE_MS),
  };
}

function packedBySku(cartons: QuiqupCarton[]) {
  const packed = new Map<string, number>();
  for (const c of cartons) for (const [s, q] of Object.entries(c.contents)) packed.set(s, (packed.get(s) ?? 0) + q);
  return packed;
}

async function requireInbound(batchId: string) {
  const inbound = await quiqupInbound(batchId);
  if (!inbound) throw new UserError("Enter the Quiqup cartons and invoice details first.");
  return inbound;
}

// One row per SKU. Quantities are what was packed once the cartons are in, so all three documents agree;
// until then, what was pre-ordered.
export async function quiqupProductImportCsv(batchId: string) {
  const items = await quiqupItems(batchId);
  const inbound = await quiqupInbound(batchId);
  const packed = inbound && packedBySku(inbound.cartons);
  return csv([
    ["SKU Code", "Barcode", "Item Name", "Total Qty", "Unit Weight (g)"],
    ...items.map((i) => [i.sku, i.sku, i.name, packed ? (packed.get(i.sku) ?? 0) : i.ordered, SHIRT_WEIGHT_G]),
  ]);
}

// One row per carton and SKU, with the carton's gross weight on its first row only. "Heigh" is Quiqup's own header.
export async function quiqupPackingListCsv(batchId: string) {
  const inbound = await requireInbound(batchId);
  const items = await quiqupItems(batchId);
  return csv([
    ["Consignee Name", "Pallet ID", "SKU Code", "Barcode", "Item Name", "Packed Qty", "Carton ID/Box No",
      "Length (In CM)*", "Width (In CM)*", "Heigh (In CM)*", "Weight (In KG)*"],
    ...inbound.cartons.flatMap((c) =>
      items.filter((it) => it.sku in c.contents).map((it, i) => [
        "Quiqup", "#001", it.sku, it.sku, it.name, c.contents[it.sku], c.box, c.lengthCm, c.widthCm, c.heightCm, i === 0 ? c.weightKg : "",
      ]),
    ),
  ]);
}

const esc = (v: string | number) =>
  String(v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const usd = (cents: number) => `USD ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The commercial invoice for customs and Quiqup's reconciliation, as a page to print or save as PDF.
// Its lines are what was packed, so it matches the packing list.
export async function quiqupInvoiceHtml(batchId: string) {
  const inbound = await requireInbound(batchId);
  const packed = packedBySku(inbound.cartons);
  const lines = (await quiqupItems(batchId))
    .filter((i) => packed.has(i.sku))
    .map((i) => ({ s: i.sku, name: i.name, qty: packed.get(i.sku)!, total: packed.get(i.sku)! * inbound.unitValueCents }));
  const qty = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.total, 0);
  const issued = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Commercial invoice ${esc(inbound.invoiceNo)}</title>
<style>
  body { margin: 0; font: 13px/1.45 Helvetica, Arial, sans-serif; color: #050505; background: #fff; }
  header { background: #050505; color: #f7f4eb; padding: 24px 32px; }
  header h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0.04em; }
  main { padding: 24px 32px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  .parties h2 { font-size: 11px; margin: 0 0 4px; letter-spacing: 0.06em; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #050505; color: #f7f4eb; text-align: left; font-size: 11px; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
  .num { text-align: right; white-space: nowrap; }
  tr.total td { background: #ffe600; font-weight: 700; border: 0; }
  .notes { margin-top: 20px; font-size: 11px; }
  .print { margin-top: 24px; }
  @media print { .print { display: none; } }
  @media (max-width: 600px) { header, main { padding: 16px; } .parties { grid-template-columns: 1fr; } }
</style></head>
<body>
<header><h1>COMMERCIAL INVOICE</h1>Invoice ${esc(inbound.invoiceNo)} &nbsp; Date ${issued}</header>
<main>
  <div class="parties">
    <div><h2>FROM (CONSIGNOR)</h2>${esc(inbound.consignor)}<br>${esc(inbound.consignorAddress)}</div>
    <div><h2>TO (CONSIGNEE)</h2>${esc(QUIQUP_CONSIGNEE.name)}<br>${esc(QUIQUP_CONSIGNEE.address)}</div>
  </div>
  <table>
    <thead><tr><th>Description (SKU)</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line total</th></tr></thead>
    <tbody>
${lines.map((l) => `      <tr><td>${esc(l.name)} (${esc(l.s)})</td><td class="num">${l.qty}</td><td class="num">${usd(inbound.unitValueCents)}</td><td class="num">${usd(l.total)}</td></tr>`).join("\n")}
      <tr class="total"><td>TOTAL</td><td class="num">${qty} units</td><td></td><td class="num">${usd(total)}</td></tr>
    </tbody>
  </table>
  <p class="notes">HS Code: ${HS_CODE} &nbsp; Country of Origin: ${ORIGIN}<br>100% cotton knitted t-shirts. Values declared for customs purposes.</p>
  <button class="print" onclick="print()">Print or save as PDF</button>
</main>
</body></html>
`;
}
