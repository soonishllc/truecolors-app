import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "@/lib/site";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Not here" }} />
      <View style={styles.page}>
        <Text style={styles.title}>That page isn&apos;t here.</Text>
        <Link href="/" style={styles.link}>Back to the shop</Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: COLORS.bg },
  title: { color: COLORS.ink, fontSize: 20, fontWeight: "700" },
  link: { marginTop: 16, color: COLORS.sun[1], fontSize: 15 },
});
