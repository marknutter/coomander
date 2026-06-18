// Metro config for the npm-workspace monorepo.
//
// By default Metro only watches the project folder and won't resolve the
// hoisted `@coomander/core` (or React Native) that live in the repo-root
// node_modules. We point it at the workspace root and tell it where to look
// for modules so the shared package resolves from apps/mobile.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in packages/core trigger reloads.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from both the app and the hoisted root node_modules.
//    Hierarchical lookup stays ENABLED so Metro still finds deps that npm
//    nested rather than hoisted (e.g. expo/node_modules/expo-modules-core).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. Force a single React copy (#194). The repo carries two: web's 19.2.4
//    hoisted at the root, mobile's 19.1.0 nested here (the RN 0.81 pairing).
//    Hierarchical lookup splits the graph — hoisted packages (react-native,
//    expo, navigation) resolve the root copy while app code and nested
//    expo-router resolve the local one — and dual React crashes Expo Go at
//    boot ("Invalid hook call" / "Cannot read property 'useMemo' of null").
//    Redirect every `react` and `react/*` import to the local 19.1.0 copy,
//    which is the version react-native 0.81's renderer is built against.
const mobileReact = path.resolve(projectRoot, "node_modules/react");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return context.resolveRequest(
      context,
      moduleName.replace(/^react/, mobileReact),
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
