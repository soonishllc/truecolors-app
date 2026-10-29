// Called by the scheduled job every 15 minutes. Needs only APP_URL and CRON_SECRET.
const res = await fetch(`${process.env.APP_URL}/api/cron/tick`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  signal: AbortSignal.timeout(10 * 60_000),
});
const text = await res.text();
console.log(res.status, text.slice(0, 4000));
if (!res.ok) process.exit(1);
