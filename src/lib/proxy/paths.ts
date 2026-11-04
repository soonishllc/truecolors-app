// Store paths under the proxy, and the app page each one shows. The bare path is the design home. Shared by the
// store page (server) and the framed app (browser), so anything outside these goes back to the design home.
export const SECTIONS = ["explore", "c", "d", "challenges", "studio", "me", "wholesale", "pre-orders", "designer-agreement", "terms", "privacy", "join", "login"];

export function appPathFor(proxyPath: string): string | undefined {
  const clean = `/${proxyPath.replace(/^\/+|\/+$/g, "")}`;
  if (clean === "/") return "/explore";
  return SECTIONS.includes(clean.split("/")[1]) ? clean : undefined;
}

export const proxyPathFor = (appPath: string) => (appPath === "/explore" ? "" : appPath);
