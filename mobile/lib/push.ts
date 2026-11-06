import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { PUSH_REGISTER } from "@/lib/site";

// Notifications for designers: backers, daily tallies, the result. Asked for only when they tap "Turn on
// notifications" in their studio, which sends a ticket saying whose studio it is; the phone's Expo push token goes
// to the site with that ticket (src/lib/push.ts in the web app).

// While the app is open, a notification still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = "on" | "denied" | "unavailable";

export async function enablePush(ticket: string): Promise<PushResult> {
  // Simulators can't receive pushes.
  if (!Device.isDevice) return "unavailable";
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Your designs", importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return "denied";
  // The Expo project the app is built under (set by `eas init`).
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return "unavailable";
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const res = await fetch(PUSH_REGISTER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform: Platform.OS, ticket }),
  });
  return res.ok ? "on" : "unavailable";
}

// The page a notification opens when it's tapped.
export const urlOf = (response: Notifications.NotificationResponse | null) =>
  (response?.notification.request.content.data as { url?: string } | undefined)?.url;
