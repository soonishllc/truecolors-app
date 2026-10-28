import { createInvite } from "../src/lib/auth/session";

// Prints an invite code for the first designer (or yourself; admins are set by ADMIN_EMAILS).
createInvite(process.argv[2] ?? "first invite").then((code) => {
  console.log(`Invite code: ${code}`);
  process.exit(0);
});
