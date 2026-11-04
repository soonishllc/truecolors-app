import { redirect } from "next/navigation";
import { config } from "@/lib/config";

// The store is the app: its home page is the retail landing page, and the design pages live inside it.
export default function Home() {
  redirect(config().STORE_URL);
}
