import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import { GET as proxy } from "@/app/proxy/[[...path]]/route";
import { config } from "@/lib/config";
import { signProxyQuery } from "@/lib/proxy/signature";
import { DEMO_CUSTOMERS } from "@/lib/shopify/customers";
import { ensureDemoAccounts } from "@/lib/wholesale/demo";
import { patchFooter, patchMarket, patchPage } from "../theme-patches";

// Local demo only: plays Shopify's part for the store pages, so the design and wholesale pages can be seen inside
// the real truecolors.global header, menu and footer before the app proxy is set up. Store pages are fetched from
// the live store (read only); /apps/truecolors/* goes through the app's own proxy route, signed as Shopify would,
// for whichever demo customer is "signed in to the store" here. The USA store's /en-us pages are served here
// too. The cart and checkout open the live store in a new tab, so this tab never leaves the preview.

const LIVE = "https://www.truecolors.global";
const BASE = "/dev/store";
const CUSTOMER = "tc_dev_customer";
const MARKET = "tc_dev_market";
// Pretend to be in another country: add ?tc_country=FR (or SA, US…) to any preview page; ?tc_country= clears it.
const COUNTRY = "tc_dev_country";
const US_PATH = "en-us";

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: Request, { params }: Ctx) {
  if (!config().WHOLESALE_DEMO) return new Response("Not found", { status: 404 });
  await ensureDemoAccounts();
  const url = new URL(req.url);
  let path = (await params).path ?? [];
  const jar = await cookies();
  // The USA store's pages: the same page, in the US market.
  if (path[0] === US_PATH) {
    path = path.slice(1);
    jar.set(MARKET, "US", { path: "/" });
  }
  const pretend = url.searchParams.get("tc_country");
  if (pretend !== null) {
    if (pretend) jar.set(COUNTRY, pretend.toUpperCase(), { path: "/" });
    else jar.delete(COUNTRY);
  }

  // The store's country detection: the live store's answer (for where this computer is), unless pretending.
  if (path.join("/") === "browsing_context_suggestions.json") {
    const country = pretend || jar.get(COUNTRY)?.value;
    if (country) return Response.json({ detected_values: { country: { handle: country.toUpperCase(), name: country.toUpperCase() } }, suggestions: [] });
    return Response.json(await (await fetch(`${LIVE}/browsing_context_suggestions.json`)).json());
  }
  const customer = jar.get(CUSTOMER)?.value ?? "";
  const market = jar.get(MARKET)?.value === "US" ? "US" : "AE";
  const here = `/${path.join("/")}${url.search}`;

  if (path[0] === "account") return account(url, path[1], customer, market);

  const proxyPrefix = config().PROXY_PATH.replace(/^\//, "").split("/");
  if (proxyPrefix.every((seg, i) => path[i] === seg)) {
    const rest = path.slice(proxyPrefix.length);
    const q = new URLSearchParams(url.searchParams);
    q.set("shop", "truecolors.myshopify.com");
    q.set("logged_in_customer_id", customer);
    q.set("path_prefix", config().PROXY_PATH);
    q.set("timestamp", String(Math.floor(Date.now() / 1000)));
    q.set("signature", signProxyQuery(q, config().SHOPIFY_PROXY_SECRET ?? ""));
    const res = await proxy(new Request(`${config().APP_URL}/proxy/${rest.join("/")}?${q}`), { params: Promise.resolve({ path: rest }) });
    if (!res.ok) return res;
    const body = (await res.text())
      .replaceAll("{{ cart.currency.iso_code }}", market === "US" ? "USD" : "AED")
      .replaceAll("{{ routes.root_url }}", BASE);
    return page(body, customer, market, here, pretend !== null);
  }

  // Any other store page: the live store's own, from this market. A page the store doesn't have stays here too.
  const live = await fetch(`${LIVE}${market === "US" ? `/${US_PATH}` : ""}/${path.join("/")}${url.search}`, { redirect: "follow" });
  if (!live.ok || !live.headers.get("content-type")?.includes("text/html")) {
    return page(
      `<section style="max-width:560px;margin:0 auto;padding:64px 20px"><div class="eyebrow">Not found</div>
        <h1 style="font-size:40px;margin-bottom:12px">That page isn't here</h1>
        <p><a class="btn-primary dark" href="/collections/all">Shop</a> <a class="btn-ghost" href="${config().PROXY_PATH}">Community designs</a></p></section>`,
      customer, market, here, false, 404,
    );
  }
  // The theme changes proposed for this page (theme-patches.ts), as they'd look once made.
  let doc = patchPage(path.join("/"), await live.text());
  // The store's wholesale page: the displays card (theme/snippets/tc-displays-card.liquid), after the opening section.
  if (path.join("/") === "pages/wholesale") {
    doc = doc.replace(/(<\/header>)(<section class="os-section tcw-open)/, `$1${await displaysCard()}$2`);
  }
  return html(await finish(doc, customer, market, here, pretend !== null));
}

// The market switch posts here, as it would to the store's /localization.
export async function POST(req: Request, { params }: Ctx) {
  if (!config().WHOLESALE_DEMO) return new Response("Not found", { status: 404 });
  const path = (await params).path ?? [];
  if (path[0] !== "localization") return new Response("Not found", { status: 404 });
  const form = await req.formData();
  (await cookies()).set(MARKET, form.get("country_code") === "US" ? "US" : "AE", { path: "/" });
  // Back to the same page in the market just picked: a USA address (/en-us/…) would put the visitor back in the USA.
  const back = String(form.get("return_to") ?? "").replace(new RegExp(`^/${US_PATH}(?=/|$)`), "") || "/";
  const to = back.startsWith(BASE) ? back : back.startsWith("/") ? `${BASE}${back}` : req.headers.get("referer") ?? BASE;
  return Response.redirect(new URL(to, config().APP_URL), 303);
}

// Stands in for the store's sign-in: pick who to be.
async function account(url: URL, action: string | undefined, customer: string, market: string) {
  const back = url.searchParams.get("return_url") ?? "/";
  const to = new URL(`${BASE}${back.startsWith("/") ? back : "/"}`, url);
  if (action === "as") {
    const id = url.searchParams.get("id") ?? "";
    const jar = await cookies();
    if (DEMO_CUSTOMERS[id]) jar.set(CUSTOMER, id, { path: "/" });
    else jar.delete(CUSTOMER);
    return Response.redirect(to, 303);
  }
  const who = (id: string, label: string) =>
    `<a class="${id === customer ? "btn-primary dark" : "btn-ghost"}" href="/account/as?id=${id}&return_url=${encodeURIComponent(back)}">${label}</a>`;
  return page(
    `<section style="max-width:560px;margin:0 auto;padding:64px 20px">
      <div class="eyebrow">Local demo · store sign-in</div>
      <h1 style="font-size:40px;margin-bottom:12px">Sign in</h1>
      <p style="color:var(--c-ink-light);margin-bottom:24px">On the live store this is Shopify's own sign-in with an emailed code. Here, pick who to be.</p>
      <div style="display:grid;gap:10px">
        ${Object.entries(DEMO_CUSTOMERS).map(([id, c]) => who(id, c.label)).join("")}
        ${who("", "Guest (signed out)")}
      </div>
    </section>`,
    customer, market, back,
  );
}

let shell: { at: number; html: string } | undefined;

// A live store page, with our content in place of its own.
async function page(body: string, customer: string, market: string, here: string, reset = false, status = 200) {
  if (!shell || Date.now() - shell.at > 10 * 60_000) {
    // A plain store page, for the header and footer every page but the home page has.
    shell = { at: Date.now(), html: await (await fetch(`${LIVE}/pages/our-story`)).text() };
  }
  const start = shell.html.indexOf('<main id="main-content"');
  const open = shell.html.indexOf(">", start) + 1;
  const end = shell.html.indexOf("</main>", open);
  // The proxy page's share card (tc_title etc), as theme.liquid would render snippets/tc-share-meta.liquid.
  const vars: Record<string, string> = {};
  body = body.replace(/\{% assign (tc_\w+) = "([^"]*)" %\}/g, (_, k: string, v: string) => ((vars[k] = v), ""));
  let doc = shell.html.slice(0, open) + body + shell.html.slice(end);
  if (vars.tc_title) {
    const esc = (v = "") => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    doc = doc.replace(/<meta (property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>\s*/g, "").replace("</head>",
      `<meta property="og:title" content="${esc(vars.tc_title)}"><meta property="og:description" content="${esc(vars.tc_description)}">` +
      `<meta name="description" content="${esc(vars.tc_description)}">` +
      (vars.tc_image ? `<meta property="og:image" content="${esc(vars.tc_image)}"><meta name="twitter:image" content="${esc(vars.tc_image)}">` : "") +
      "</head>");
  }
  // The page's own title comes from the app once it loads; until then, the store's name, not "our-story".
  const title = vars.tc_title ? vars.tc_title.replace(/</g, "") : "Truecolors";
  return html(await finish(doc.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`), customer, market, here, reset), status);
}

// A store page as the preview serves it: links kept in the preview, and the market picked by location.
async function finish(doc: string, customer: string, market: string, here: string, reset: boolean) {
  return rewrite(doc, customer, market, here).replace("</body>", `${await marketSnippet(market, reset)}</body>`);
}

// The theme snippets are read on every request, so edits to them show straight away in this preview.

// The displays card snippet as the theme would render it: its render from the app, its links in this preview.
async function displaysCard() {
  return (await readFile(join(process.cwd(), "theme/snippets/tc-displays-card.liquid"), "utf8"))
    .replace(/\{%-? comment -?%\}[\s\S]*?\{%-? endcomment -?%\}/, "")
    .replace("{{ 'tc-display-tower.jpg' | asset_url }}", `${config().APP_URL}/displays/tc-display-tower.jpg`)
    .replaceAll("{{ routes.root_url | append: '/' | replace: '//', '/' }}", "/");
}

// The theme snippets this preview adds to every store page, as the live theme would render them: the market by
// location, and the header and footer on phones.
async function marketSnippet(market: string, reset: boolean) {
  const detect = await readFile(join(process.cwd(), "theme/snippets/tc-market-from-location.liquid"), "utf8");
  const phone = (await readFile(join(process.cwd(), "theme/snippets/tc-phone-store.liquid"), "utf8"))
    .replace(/\{%-? comment -?%\}[\s\S]*?\{%-? endcomment -?%\}/, "");
  const js = detect
    .replace(/\{%-? comment -?%\}[\s\S]*?\{%-? endcomment -?%\}/, "")
    .replaceAll("{{ localization.country.iso_code }}", market)
    .replaceAll("{{ routes.root_url | append: '/' | replace: '//', '/' }}", `${BASE}/`);
  // Pretending to be somewhere new: forget the earlier choice so detection runs again.
  return (reset ? `<script>try{localStorage.removeItem("tc_market_chosen")}catch(e){}</script>` : "") + js + phone;
}

function rewrite(doc: string, customer: string, market: string, here: string) {
  const name = DEMO_CUSTOMERS[customer]?.firstName;
  const proxy = config().PROXY_PATH;
  return patchMarket(patchFooter(doc), market === "US" ? "US" : "AE")
    // The market is kept by the preview (a cookie), so the USA store's links lose their /en-us.
    .replace(new RegExp(`(href|action)="/${US_PATH}(?=[/"?#])/?`, "g"), '$1="/')
    // What the store's menu and footer would hold: Design next to the store's own Wholesale page, which links on
    // to the wholesale portal.
    .replace('<li ><a href="/pages/wholesale">Wholesale</a></li>', `<li ><a href="${proxy}">Design</a></li><li ><a href="/pages/wholesale">Wholesale</a></li>`)
    .replace('<a href="/collections/all">All Drops</a>', `<a href="/collections/all">All Drops</a><a href="${proxy}">Community designs</a>`)
    .replaceAll('<a href="/#wholesale">Wholesale</a>', '<a href="/pages/wholesale">Wholesale</a>')
    // The colour logo, for the black header on every page (see theme/snippets/tc-phone-store.liquid).
    .replace(/(class="header-logo"[^>]*><img src="[^"]*)TrueColors_1line_color_black_[^"?]*\.png/, "$1TRUECOLORSNEW.png")
    // The market switch returns to the page it was used on (an app page's shell is another store page).
    .replace(/(name="return_to" value=")[^"]*"/g, `$1${here.replace(/"/g, "&quot;")}"`)
    // The live theme draws header links (Cart) dark on their dark button, off the home page; this is the
    // one-line fix the theme needs, applied here so the preview is usable.
    .replace("</head>", `<style>.site-header a.cart-btn{color:#fff}
</style></head>`)
    // An account link, which the store's header doesn't have yet.
    // It returns to the page it was opened from.
    .replace('<a href="/cart" class="cart-btn"', `<a href="/account/login?return_url=${encodeURIComponent(here)}" class="cart-btn tc-account">${name ? `Hi, ${name}` : "Sign in"}</a> <a href="/cart" class="cart-btn"`)
    // The market switch shows the market this visitor is in.
    .replace(/(tc-market-switch__trigger"[^>]*>)\s*UAE\s*</g, `$1 ${market === "US" ? "US" : "UAE"} <`)
    .replace(/value="(AE|US)"(\s*role="option"\s*)aria-selected="(?:true|false)"(\s*class="tc-market-switch__option)(?: is-current)?"/g,
      (_, v, a, b) => `value="${v}"${a}aria-selected="${v === market}"${b}${v === market ? " is-current" : ""}"`)
    // Store links stay in this preview; the cart and checkout open the live store in a new tab.
    .replace(/(href|action)="\/(?!\/)(?!cart|checkout)/g, `$1="${BASE}/`)
    .replace(/(href|action)="\/(cart|checkout)/g, `target="_blank" $1="${LIVE}/$2`);
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
