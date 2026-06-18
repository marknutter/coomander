import { registerRootComponent } from "expo";
import { ExpoRoot } from "expo-router";
import React from "react";

// Custom entry — monorepo workaround for expo/expo#27299.
//
// expo-router's default entry (`expo-router/entry`) loads routes via
// `require.context(process.env.EXPO_ROUTER_APP_ROOT)`. In this workspace
// expo-router resolves nested (apps/mobile/node_modules) rather than hoisted,
// so babel-preset-expo (hoisted) does not run the transform that inlines
// EXPO_ROUTER_APP_ROOT, and Metro fails: "First argument of require.context
// should be a string". Calling require.context with a LITERAL path here lets
// Metro's static require.context handling resolve it directly, no env inlining
// needed. Drop this and restore `"main": "expo-router/entry"` once expo-router
// hoists (e.g. after aligning the web/mobile dependency baselines).
export function App() {
  const ctx = require.context("./src/app");
  return React.createElement(ExpoRoot, { context: ctx });
}

registerRootComponent(App);
