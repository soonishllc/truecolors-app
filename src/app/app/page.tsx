import { notFound } from "next/navigation";
import { AppPreview, type Step } from "@/components/app/AppPreview";
import { config } from "@/lib/config";
import { ensureDemoAccounts } from "@/lib/wholesale/demo";

export const dynamic = "force-dynamic";

// The flow through the app, from a shopper to a wholesaler, the bot and a designer. Each step opens the page
// that person would see; the team's step opens the admin in its own tab, since it isn't part of the app.

// Signs in to the (local) store as a demo customer, then opens a store page.
const as = (customer: string, path: string) => `/dev/store/account/as?id=${customer}&return_url=${encodeURIComponent(path)}`;

const STEPS: Step[] = [
  { who: "Shopper", what: "Browses the store", url: as("", "/collections/all") },
  { who: "Shopper", what: "Pre-orders a design by the community", url: as("", "/apps/truecolors") },
  { who: "Gift shop owner", what: "Asks about wholesale on WhatsApp, and the bot answers", url: "/app/chat?as=new" },
  { who: "Sara · stockist", what: "Signs in to the store and orders at wholesale prices", url: as("9102", "/apps/truecolors/wholesale/order") },
  { who: "Sara · stockist", what: "Asks the bot for a shirt of her location", url: "/app/chat?as=stockist" },
  { who: "Truecolors team", what: "Assigns the design brief to a designer", url: "/app/demo-login?as=admin&next=/admin/wholesale", staff: true },
  { who: "Maya · designer", what: "Signs in to the store and sends a design from the studio", url: as("9101", "/apps/truecolors/studio") },
  { who: "Sara · stockist", what: "Approves it, and it joins her catalog", url: as("9102", "/apps/truecolors/wholesale") },
  { who: "Lucía · display partner", what: "Checks the stock on her display", url: as("9103", "/apps/truecolors/wholesale") },
  { who: "Lucía · display partner", what: "Reports sales to the bot and asks for a restock", url: "/app/chat?as=partner" },
];

export default async function AppPreviewPage() {
  if (!config().WHOLESALE_DEMO) notFound();
  await ensureDemoAccounts();
  return <AppPreview steps={STEPS} />;
}
