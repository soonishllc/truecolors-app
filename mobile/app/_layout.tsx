import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { COLORS } from "@/lib/site";

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
