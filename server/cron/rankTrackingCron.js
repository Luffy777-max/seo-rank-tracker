import cron from "node-cron";
import KeywordTracking from "../models/keywordTracking.js";
import { keywordTracking } from "../services/keywordTrackingService.js";

export function startRankTrackingCron() {
    // Runs every day at 6:00 AM
    cron.schedule("0 6 * * *", async () => {
        console.log("Starting daily rank tracking...");
        try {
            const activeTrackings = await KeywordTracking.find({ active: true });

            for (const tracking of activeTrackings) {
                tracking.status = "checking";
                await tracking.save();

                await keywordTracking(tracking);

                // Delay 10–15 seconds between keywords to avoid rate limits
                await new Promise((resolve) =>
                    setTimeout(resolve, 10000 + Math.random() * 5000)
                );
            }
            console.log("Daily rank tracking finished.");
        } catch (error) {
            console.error("Rank tracking cron error:", error.message);
        }
    });

    console.log("Rank tracking cron job scheduled (daily at 6:00 AM)");
}