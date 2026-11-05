import { Stack, useLocalSearchParams } from "expo-router";
import { WebScreen } from "@/components/WebScreen";
import { STORE, staysInside } from "@/lib/site";

// A page opened from the Me tab, with a back button to it.
export default function Web() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const safe = url && staysInside(url) ? url : STORE;
  return (
    <>
      <Stack.Screen options={{ title: title ?? "Truecolors" }} />
      <WebScreen url={safe} underHeader />
    </>
  );
}
