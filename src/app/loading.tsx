// Shown while the next page loads, so a tap always gets an answer (inside the store, the page itself is framed).
export default function Loading() {
  return <div className="page-loading" role="status" aria-label="Loading" />;
}
