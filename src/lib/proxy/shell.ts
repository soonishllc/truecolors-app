import { config } from "../config";

// The page Shopify renders inside the store's theme for every /apps/truecolors path: the store's own header, menu
// and footer around the app's page for that path, framed. The frame reports its height and current page, so the
// store page grows to fit and its address follows along.

export { appPathFor, proxyPathFor } from "./paths";

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

// `query` is the store page's own query string (e.g. a referral code), passed on to the app page.
export function storeShell(input: { prefix: string; appPath: string; query: string; handoff: string }) {
  const app = new URL(config().APP_URL).origin;
  const src = new URL(input.appPath, app);
  new URLSearchParams(input.query).forEach((v, k) => src.searchParams.append(k, v));
  const start = new URL("/embed", app);
  start.searchParams.set("t", input.handoff);
  start.searchParams.set("next", src.pathname + src.search);
  // The Liquid here is ours, not user content: the market comes from the store so prices and checkout links match it.
  return `<div class="tc-embed" style="max-width:1280px;margin:0 auto;padding:24px 20px 48px">
  <iframe id="tc-app" title="Truecolors" scrolling="no" data-src="${start.toString().replace(/"/g, "&quot;")}" style="display:block;width:100%;min-height:80vh;border:0;overflow:hidden"></iframe>
</div>
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
  frame.addEventListener("load", function () { setTimeout(scrollToAnchor, 100); });
  window.addEventListener("message", function (e) {
    if (e.origin !== app || !e.data || e.data.type !== "tc-frame") return;
    if (e.data.reload) {
      // Once only, so a clock that's out would show the page rather than reload for ever.
      try { if (sessionStorage.getItem("tc-reloaded")) return; sessionStorage.setItem("tc-reloaded", "1"); } catch (_) { return; }
      return location.reload();
    }
    if (e.data.height) frame.style.height = e.data.height + "px";
    if (e.data.path) {
      var path = e.data.path === "/explore" ? "" : e.data.path;
      history.replaceState(null, "", root + prefix + path + (e.data.search || "") + (e.data.hash || ""));
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
