// The link with utm_source=<channel>&utm_medium=share&utm_campaign=<slug, from a /c/<slug> path>, keeping ?ref.
export function withUtm(url: string, source: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", "share");
    const slug = u.pathname.match(/\/c\/([^/]+)/)?.[1];
    if (slug) u.searchParams.set("utm_campaign", decodeURIComponent(slug));
    return u.toString();
  } catch {
    return url;
  }
}
