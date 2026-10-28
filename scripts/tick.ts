import { tick } from "../src/lib/campaigns/service";

tick().then((log) => {
  console.log(log.length ? log.join("\n") : "Nothing to do.");
  process.exit(0);
});
