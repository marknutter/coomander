/**
 * Jest config for the Expo mobile app.
 *
 * Uses the `jest-expo` preset (SDK 54 toolchain: babel-jest, the RN/Expo
 * transform allow-list, and react-test-renderer 19.1.0).
 *
 * `moduleNameMapper`:
 *  - `@/*` mirrors the tsconfig path aliases so tests import like the app does.
 *  - `react` is pinned to this workspace's nested copy (19.1.0, Expo SDK 54).
 *    In the npm-workspace monorepo, react@19.2.4 (from the Next.js web app)
 *    hoists to the repo root, so a root-hoisted `@testing-library/react-native`
 *    would otherwise resolve 19.2.4 and reject react-test-renderer@19.1.0.
 *    Forcing react to the mobile copy keeps react / react-test-renderer aligned.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: "jest-expo",
  moduleNameMapper: {
    "^react$": "<rootDir>/node_modules/react",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
    "^@/assets/(.*)$": "<rootDir>/assets/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
