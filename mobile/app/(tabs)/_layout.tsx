import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { COLORS } from "@/lib/site";

type Icon = { ios: SymbolViewProps["name"]; android: string };

function icon(name: Icon) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <SymbolView name={{ ios: name.ios, android: name.android, web: name.android } as SymbolViewProps["name"]} tintColor={color as string} size={24} />;
  };
}

// The four ways in: the store, the community's designs, designing your own, and everything that's yours.
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.ink,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarStyle: { backgroundColor: COLORS.bar, borderTopColor: COLORS.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Shop", tabBarIcon: icon({ ios: "bag", android: "shopping_bag" }) }} />
      <Tabs.Screen name="designs" options={{ title: "Designs", tabBarIcon: icon({ ios: "sun.max", android: "wb_sunny" }) }} />
      <Tabs.Screen name="create" options={{ title: "Create", tabBarIcon: icon({ ios: "pencil.and.outline", android: "edit" }) }} />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: icon({ ios: "person.crop.circle", android: "account_circle" }) }} />
    </Tabs>
  );
}
