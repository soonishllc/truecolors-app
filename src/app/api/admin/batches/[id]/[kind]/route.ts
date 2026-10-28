import { currentUser } from "@/lib/auth/session";
import { inboundCsv, workOrderCsv } from "@/lib/production/batch";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const user = await currentUser();
  if (!user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const { id, kind } = await params;
  const body = kind === "work-order" ? await workOrderCsv(id) : kind === "inbound" ? await inboundCsv(id) : undefined;
  if (body === undefined) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="batch-${id.slice(0, 8)}-${kind}.csv"`,
    },
  });
}
