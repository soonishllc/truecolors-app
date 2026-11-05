import { currentUser } from "@/lib/auth/session";
import { UserError } from "@/lib/design/service";
import { editionsCsv, lasVegasInboundCsv, workOrderCsv } from "@/lib/production/batch";
import { quiqupInvoiceHtml, quiqupPackingListCsv, quiqupProductImportCsv } from "@/lib/production/quiqup";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const user = await currentUser();
  if (!user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const { id, kind } = await params;
  const exports: Record<string, (batchId: string) => Promise<string>> = {
    "work-order": workOrderCsv, "las-vegas-inbound": lasVegasInboundCsv, editions: editionsCsv,
    "quiqup-products": quiqupProductImportCsv, "quiqup-packing-list": quiqupPackingListCsv, "quiqup-invoice": quiqupInvoiceHtml,
  };
  const make = exports[kind];
  if (!make) return new Response("Not found", { status: 404 });
  let body: string;
  try {
    body = await make(id);
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 409 });
    throw e;
  }
  // The invoice opens as a page to print or save as PDF; the rest download as CSV.
  if (kind === "quiqup-invoice") return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="batch-${id.slice(0, 8)}-${kind}.csv"`,
    },
  });
}
