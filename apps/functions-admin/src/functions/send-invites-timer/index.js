import { app } from "@azure/functions";
import { enqueueInvites } from "../send-invites/index.js";


app.timer("send-invites-timer", {
  // 1 juli 2026 om 09:00 Nederlandse tijd
  // 07:00 UTC, omdat Nederland dan zomertijd heeft
  schedule: "0 0 7 1 7 *",

  disabled: process.env.SEND_INVITES_DISABLED === "true",

  handler: async (timer, context) => {
    const now = new Date();

    const isTargetDate =
      now.getUTCFullYear() === 2026 &&
      now.getUTCMonth() === 6 && // juli; maanden beginnen bij 0
      now.getUTCDate() === 1;

    if (!isTargetDate) {
      context.log("Overgeslagen: alleen uitvoeren op 1 juli 2026.");
      return;
    }

    await enqueueInvites({ dryRun: false });
  },
});