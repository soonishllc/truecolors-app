import * as Notifications from "expo-notifications";
import { DarkTheme, router, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { urlOf } from "@/lib/push";
import { COLORS, staysInside } from "@/lib/site";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = { anchor: "(tabs)" };

SplashScreen.preventAutoHideAsync();

// Dark, like the store's header and the design pages, whatever the phone's setting.
const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: COLORS.bg, card: COLORS.bar, border: COLORS.line, primary: COLORS.ink, text: COLORS.ink },
};

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  // A tapped notification opens its page (a design's campaign, or the studio), whether the app was open or not.
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const url = urlOf(response);
      if (url && staysInside(url)) router.push({ pathname: "/web", params: { url, title: "Truecolors" } });
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="web" options={{ headerBackTitle: "Back" }} />
      </Stack>
    </ThemeProvider>
  );
}
