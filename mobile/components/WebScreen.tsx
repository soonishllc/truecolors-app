import { useNavigation } from "expo-router";
import { type ComponentRef, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { COLORS, staysInside } from "@/lib/site";

// One live store page, full screen under the status bar. The site knows it's in the app by "TruecolorsApp" in
// the browser name, and drops its own menu pills for the app's tab bar. Sharing uses the phone's share sheet,
// links to other apps (Instagram, WhatsApp, email) open those apps, and Android's back button goes back a page.

// The page's share button calls navigator.share; in the app it reaches the phone's share sheet instead.
const BRIDGE = `
(function () {
  if (!window.ReactNativeWebView) return;
  navigator.share = function (data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "share", data: data || {} }));
    return Promise.resolve();
  };
  navigator.canShare = function () { return true; };
})();
true;`;

export type WebScreenHandle = { home: () => void };

// `underHeader`: opened with a native back bar above it, so it doesn't need room for the status bar.
export const WebScreen = forwardRef<WebScreenHandle, { url: string; tabRoot?: boolean; underHeader?: boolean }>(function WebScreen({ url, tabRoot, underHeader }, ref) {
  const web = useRef<ComponentRef<typeof WebView>>(null);
  const safe = useSafeAreaInsets();
  const insets = underHeader ? { ...safe, top: 0 } : safe;
  const navigation = useNavigation();
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [source, setSource] = useState({ uri: url });

  // Tapping the tab again: back to the tab's first page, at the top.
  const home = useCallback(() => {
    setFailed(false);
    setSource({ uri: `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}` });
  }, [url]);
  useImperativeHandle(ref, () => ({ home }), [home]);

  useEffect(() => {
    if (!tabRoot) return;
    return navigation.addListener("tabPress" as never, () => {
      if (navigation.isFocused()) home();
    });
  }, [navigation, tabRoot, home]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack && navigation.isFocused()) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack, navigation]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; data: { title?: string; text?: string; url?: string } };
      if (msg.type !== "share") return;
      const { text, url: link } = msg.data;
      Share.share(Platform.OS === "ios" ? { message: text ?? "", url: link } : { message: [text, link].filter(Boolean).join(" ") });
    } catch {}
  };

  const onRequest = (req: WebViewNavigation & { isTopFrame?: boolean }) => {
    if (staysInside(req.url)) return true;
    // Only links the shopper opens leave the app; a frame's own requests are left alone.
    if (req.isTopFrame === false) return true;
    Linking.openURL(req.url).catch(() => {});
    return false;
  };

  if (failed) {
    return (
      <View style={[styles.fill, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>You&apos;re offline</Text>
        <Text style={styles.body}>Check your connection, then try again.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); web.current?.reload(); }} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <WebView
        ref={web}
        source={source}
        style={styles.web}
        applicationNameForUserAgent="TruecolorsApp/1.0"
        injectedJavaScriptBeforeContentLoaded={BRIDGE}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onRequest}
        onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
        onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
        onError={() => setFailed(true)}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        allowFileAccess
        decelerationRate="normal"
        startInLoadingState
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <ActivityIndicator color={COLORS.ink} />
          </View>
        )}
      />
      {progress > 0 && progress < 1 && <View style={[styles.progress, { top: insets.top, width: `${progress * 100}%` }]} />}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.bg },
  web: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: COLORS.bg },
  progress: { position: "absolute", left: 0, height: 2, backgroundColor: COLORS.sun[1] },
  title: { color: COLORS.ink, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  body: { color: COLORS.muted, fontSize: 15, textAlign: "center", marginBottom: 20 },
  button: { backgroundColor: COLORS.ink, borderRadius: 4, paddingHorizontal: 24, paddingVertical: 14 },
  buttonText: { color: COLORS.bg, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
});
