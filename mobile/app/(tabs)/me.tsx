import { Image } from "expo-image";
import { router } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP, COLORS, STORE } from "@/lib/site";

type Row = { label: string; hint?: string; url?: string; external?: string };

// Everything that's yours, in one list: orders, pre-orders, your studio, the wholesale portal, and help. Each opens
// the live page with a back button; email and WhatsApp open their own apps.
const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Shopping",
    rows: [
      { label: "My orders", hint: "Orders, addresses and sign-in", url: `${STORE}/account` },
      { label: "My pre-orders", hint: "Community designs you've backed, and your friend link", url: `${APP}/me` },
    ],
  },
  {
    title: "Designing",
    rows: [
      { label: "My studio", hint: "Your designs, campaigns and earnings", url: `${APP}/studio` },
      { label: "New design", url: `${APP}/studio/new` },
    ],
  },
  {
    title: "Wholesale",
    rows: [
      { label: "Partner portal", hint: "Orders, displays, sales reports and restocks", url: `${APP}/wholesale` },
      { label: "Host a display", url: `${APP}/wholesale/displays` },
    ],
  },
  {
    title: "Help",
    rows: [
      { label: "Pre-orders, shipping and returns", url: `${APP}/pre-orders` },
      { label: "Email us", hint: "hello@truecolors.global", external: "mailto:hello@truecolors.global" },
      { label: "Privacy", url: `${APP}/privacy` },
      { label: "Terms", url: `${APP}/terms` },
    ],
  },
];

function open(row: Row) {
  if (row.external) Linking.openURL(row.external).catch(() => {});
  else if (row.url) router.push({ pathname: "/web", params: { url: row.url, title: row.label } });
}

export default function Me() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}>
      <Image source={require("@/assets/images/truecolors-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="Truecolors" />
      {SECTIONS.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text style={styles.heading}>{s.title}</Text>
          <View style={styles.card}>
            {s.rows.map((r, i) => (
              <Pressable
                key={r.label}
                onPress={() => open(r)}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <View style={styles.rowText}>
                  <Text style={styles.label}>{r.label}</Text>
                  {r.hint && <Text style={styles.hint}>{r.hint}</Text>}
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Text style={styles.foot}>Made in Cancún · ships from Dubai and Las Vegas</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.bg },
  logo: { width: 180, height: 32, marginHorizontal: 20, marginBottom: 12 },
  section: { marginTop: 20, paddingHorizontal: 16 },
  heading: { color: COLORS.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: COLORS.bar, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.line },
  pressed: { backgroundColor: "#ffffff10" },
  rowText: { flex: 1, gap: 2 },
  label: { color: COLORS.ink, fontSize: 16, fontWeight: "600" },
  hint: { color: COLORS.muted, fontSize: 13 },
  chevron: { color: COLORS.muted, fontSize: 24, marginLeft: 8 },
  foot: { color: COLORS.muted, fontSize: 12, textAlign: "center", marginTop: 28 },
});
