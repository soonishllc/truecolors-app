import { config } from "../config";
import {
  CARTON_KG, CUSTOMS_DESCRIPTION, HS_CODE, SHIP_FROM, SHIRT_KG, SHIRTS_PER_CARTON,
} from "../rules";
import type { ShipTo } from "../shopify/wholesale";

// Books stockist shipments from the Cancún hub through the FedEx Ship API: one call returns the air waybill
// (master tracking number), a label per carton and, for shipments abroad, the commercial invoice. Duties are
// billed to Truecolors (delivered duty paid). Request shapes follow FedEx's Ship API v1; book against the
// sandbox (FEDEX_SANDBOX=true) before the first real shipment.

export class FedexError extends Error {}

export type Shipment = {
  trackingNumber: string;
  // Base64 PDFs: every carton label, then the commercial invoice when there is one.
  documents: { kind: "label" | "commercial_invoice"; pdf: string }[];
};

// FedEx still uses its own codes for a few currencies.
const FEDEX_CURRENCY: Record<string, string> = { MXN: "NMP", AED: "DHS" };

const base = () => (config().FEDEX_SANDBOX ? "https://apis-sandbox.fedex.com" : "https://apis.fedex.com");

export const fedexReady = () => {
  const c = config();
  return Boolean(c.FEDEX_API_KEY && c.FEDEX_SECRET_KEY && c.FEDEX_ACCOUNT_NUMBER && SHIP_FROM.street && SHIP_FROM.phone && SHIP_FROM.postalCode);
};

let token: { value: string; expires: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const { FEDEX_API_KEY, FEDEX_SECRET_KEY } = config();
  const res = await fetch(`${base()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: FEDEX_API_KEY!, client_secret: FEDEX_SECRET_KEY! }),
  });
  if (!res.ok) throw new FedexError(`FedEx sign-in answered ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

// Splits the shirts into cartons of up to SHIRTS_PER_CARTON, each weighed by its shirts plus the box.
export function cartons(units: number): number[] {
  const out: number[] = [];
  for (let left = units; left > 0; left -= SHIRTS_PER_CARTON) out.push(Math.min(left, SHIRTS_PER_CARTON));
  return out;
}

const kg = (shirts: number) => Math.round((shirts * SHIRT_KG + CARTON_KG) * 100) / 100;

export function shipmentRequest(input: {
  shipTo: ShipTo; units: number; currency: string; customsValue: string; reference: string; date: Date;
}) {
  const { shipTo } = input;
  const abroad = shipTo.country !== SHIP_FROM.country;
  const currency = FEDEX_CURRENCY[input.currency] ?? input.currency;
  const boxes = cartons(input.units);
  return {
    labelResponseOptions: "LABEL",
    accountNumber: { value: config().FEDEX_ACCOUNT_NUMBER },
    requestedShipment: {
      shipper: {
        contact: { personName: SHIP_FROM.person || SHIP_FROM.company, companyName: SHIP_FROM.company, phoneNumber: SHIP_FROM.phone },
        address: {
          streetLines: [SHIP_FROM.street], city: SHIP_FROM.city, stateOrProvinceCode: SHIP_FROM.state,
          postalCode: SHIP_FROM.postalCode, countryCode: SHIP_FROM.country,
        },
      },
      recipients: [
        {
          contact: {
            personName: shipTo.name, companyName: shipTo.company, phoneNumber: shipTo.phone ?? "", emailAddress: shipTo.email,
          },
          address: {
            streetLines: shipTo.street, city: shipTo.city, stateOrProvinceCode: shipTo.state,
            postalCode: shipTo.postalCode, countryCode: shipTo.country,
          },
        },
      ],
      shipDatestamp: input.date.toISOString().slice(0, 10),
      serviceType: config().FEDEX_SERVICE_TYPE,
      packagingType: "YOUR_PACKAGING",
      pickupType: "USE_SCHEDULED_PICKUP",
      shippingChargesPayment: { paymentType: "SENDER" },
      labelSpecification: { imageType: "PDF", labelStockType: "PAPER_85X11_TOP_HALF_LABEL" },
      requestedPackageLineItems: boxes.map((shirts, i) => ({
        sequenceNumber: i + 1,
        weight: { units: "KG", value: kg(shirts) },
        customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: input.reference }],
      })),
      ...(abroad && {
        customsClearanceDetail: {
          dutiesPayment: { paymentType: "SENDER" },
          isDocumentOnly: false,
          commodities: [
            {
              description: CUSTOMS_DESCRIPTION,
              countryOfManufacture: SHIP_FROM.country,
              harmonizedCode: HS_CODE,
              quantity: input.units,
              quantityUnits: "PCS",
              weight: { units: "KG", value: Math.round(input.units * SHIRT_KG * 100) / 100 },
              unitPrice: { amount: Number((Number(input.customsValue) / input.units).toFixed(2)), currency },
              customsValue: { amount: Number(input.customsValue), currency },
            },
          ],
        },
        shippingDocumentSpecification: {
          shippingDocumentTypes: ["COMMERCIAL_INVOICE"],
          commercialInvoiceDetail: { documentFormat: { docType: "PDF", stockType: "PAPER_LETTER" } },
        },
      }),
    },
  };
}

type ShipResponse = {
  output?: {
    transactionShipments?: {
      masterTrackingNumber?: string;
      pieceResponses?: { trackingNumber?: string; packageDocuments?: { encodedLabel?: string }[] }[];
      shipmentDocuments?: { contentType?: string; encodedLabel?: string }[];
    }[];
  };
  errors?: { code: string; message: string }[];
};

export async function bookShipment(input: Parameters<typeof shipmentRequest>[0]): Promise<Shipment> {
  if (!fedexReady()) throw new FedexError("FedEx isn't set up: add the FEDEX_ keys and the Cancún hub address in rules.ts");
  const res = await fetch(`${base()}/ship/v1/shipments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", "X-locale": "en_US" },
    body: JSON.stringify(shipmentRequest(input)),
  });
  const body = (await res.json().catch(() => ({}))) as ShipResponse;
  if (!res.ok || body.errors?.length) {
    throw new FedexError(`FedEx answered ${res.status}: ${body.errors?.map((e) => e.message).join("; ") ?? "no detail"}`);
  }
  const t = body.output?.transactionShipments?.[0];
  const trackingNumber = t?.masterTrackingNumber ?? t?.pieceResponses?.[0]?.trackingNumber;
  if (!trackingNumber) throw new FedexError("FedEx booked nothing: no tracking number came back");
  const labels = (t?.pieceResponses ?? []).flatMap((p) => p.packageDocuments ?? []).map((d) => d.encodedLabel).filter(Boolean) as string[];
  const invoices = (t?.shipmentDocuments ?? []).map((d) => d.encodedLabel).filter(Boolean) as string[];
  return {
    trackingNumber,
    documents: [
      ...labels.map((pdf) => ({ kind: "label" as const, pdf })),
      ...invoices.map((pdf) => ({ kind: "commercial_invoice" as const, pdf })),
    ],
  };
}
