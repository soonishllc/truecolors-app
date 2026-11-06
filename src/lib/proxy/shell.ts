import { config } from "../config";
import type { ShareMeta } from "./share-meta";

// The page Shopify renders inside the store's theme for every /apps/truecolors path: the store's own header, menu
// and footer around the app's page for that path, framed. The frame reports its height and current page, so the
// store page grows to fit and its address follows along.

export { appPathFor, proxyPathFor } from "./paths";

// A Liquid string literal: no quotes or tags can break out of it.
const liquid = (v: string) => `"${v.replace(/["{}%<>]/g, "")}"`;
const shareAssigns = (m: ShareMeta) =>
  `{% assign tc_title = ${liquid(m.title)} %}{% assign tc_description = ${liquid(m.description)} %}` +
  (m.image ? `{% assign tc_image = ${liquid(m.image)} %}` : "");

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

// `query` is the store page's own query string (e.g. a referral code), passed on to the app page.
// `meta`, for a page worth a share card (a campaign), is handed to the theme as Liquid variables: the template is
// rendered before the layout, so theme.liquid's <head> can pass them to snippets/tc-share-meta.liquid.
export function storeShell(input: { prefix: string; appPath: string; query: string; handoff: string; meta?: ShareMeta }) {
  const app = new URL(config().APP_URL).origin;
  const src = new URL(input.appPath, app);
  new URLSearchParams(input.query).forEach((v, k) => src.searchParams.append(k, v));
  const start = new URL("/embed", app);
  start.searchParams.set("t", input.handoff);
  start.searchParams.set("next", src.pathname + src.search);
  // The Liquid here is ours, not user content: the market comes from the store so prices and checkout links match it.
  // The app's pages are dark, so the band around the frame is too, edge to edge (the same colour as html.in-app's --bg).
  // Full width, no side padding: the app centres and pads its own pages, so its hero can run to the screen's edges.
  return `${input.meta ? shareAssigns(input.meta) : ""}<div style="background:oklch(0.16 0.01 80)"><div class="tc-embed" style="padding:16px 0 48px">
  <iframe id="tc-app" title="Truecolors" scrolling="no" allow="clipboard-write; web-share" data-src="${start.toString().replace(/"/g, "&quot;")}" style="display:block;width:100%;min-height:80vh;border:0;overflow:hidden;color-scheme:dark"></iframe>
</div></div>
<script>
(function () {
  var frame = document.getElementById("tc-app");
  var app = ${json(app)}, prefix = ${json(input.prefix)};
  // The store's market, by its currency: USD is the USA store, anything else the UAE store.
  var market = "{{ cart.currency.iso_code }}" === "USD" ? "US" : "AE";
  var root = "{{ routes.root_url }}".replace(/\\/$/, "");
  // The anchor (e.g. #designs) never reaches the server, so it's passed on from here.
  frame.src = frame.getAttribute("data-src") + "&market=" + encodeURIComponent(market) +
    (location.hash ? "&hash=" + encodeURIComponent(location.hash.slice(1)) : "");
  // Where the frame asked to be scrolled to (an anchor), applied again once the frame has loaded, since the
  // browser resets the store page's scroll when the frame finishes loading.
  // The theme hides overflow on both html and body, so the page may not scroll as the window; scrolling a marker
  // into view works whichever element scrolls.
  var anchor = null;
  var box = frame.parentNode;
  var marker = document.createElement("div");
  box.style.position = "relative";
  marker.style.cssText = "position:absolute;left:0;width:1px;height:1px;scroll-margin-top:96px;pointer-events:none";
  box.appendChild(marker);
  var scrollToY = function (y) {
    marker.style.top = y + "px";
    marker.scrollIntoView({ block: "start" });
  };
  var scrollToAnchor = function () {
    if (anchor !== null) scrollToY(frame.offsetTop + anchor);
  };
  // Which part of the frame is on screen, so the app can pin its buy bar to the bottom of the screen and play its
  // sun sweeps as designs scroll into view (the frame itself never scrolls). Any element may be the one scrolling.
  var viewport = function () {
    if (!frame.contentWindow) return;
    // The store's header stays pinned at the top, so the part of the screen under it doesn't count as visible.
    var head = document.querySelector(".shopify-section-group-header-group");
    var covered = head ? Math.max(0, head.getBoundingClientRect().bottom) : 0;
    frame.contentWindow.postMessage({ type: "tc-viewport", top: covered - frame.getBoundingClientRect().top, height: window.innerHeight - covered }, app);
  };
  // Each page the visitor moves to inside the frame is a pageview in the store's analytics (the theme loads
  // Plausible); the address only changes by replaceState, which Plausible doesn't count by itself.
  var counted = location.href;
  var queued = false;
  var onScroll = function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; viewport(); });
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onScroll);
  frame.addEventListener("load", function () { setTimeout(scrollToAnchor, 100); setTimeout(viewport, 150); });
  window.addEventListener("message", function (e) {
    if (e.origin !== app || !e.data || e.data.type !== "tc-frame") return;
    if (e.data.reload) {
      // Once only, so a clock that's out would show the page rather than reload for ever.
      try { if (sessionStorage.getItem("tc-reloaded")) return; sessionStorage.setItem("tc-reloaded", "1"); } catch (_) { return; }
      return location.reload();
    }
    // A request for the phone app (turning on notifications): the app listens to this page, not to the frame.
    if (e.data.native && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(e.data.native));
    if (e.data.height) frame.style.height = e.data.height + "px";
    if (e.data.height || e.data.viewport) onScroll();
    if (e.data.path) {
      var path = e.data.path === "/explore" ? "" : e.data.path;
      history.replaceState(null, "", root + prefix + path + (e.data.search || "") + (e.data.hash || ""));
      var now = location.href.split("#")[0];
      if (now !== counted.split("#")[0] && typeof window.plausible === "function") window.plausible("pageview");
      counted = now;
    }
    if (e.data.title) document.title = e.data.title === "Truecolors" ? e.data.title : e.data.title + " · Truecolors";
    if (e.data.top) {
      anchor = null;
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    }
    if (typeof e.data.scrollTo === "number") {
      anchor = e.data.scrollTo;
      scrollToAnchor();
    }
  });
})();
</script>`;
}
