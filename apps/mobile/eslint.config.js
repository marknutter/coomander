// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // HTML-entity escaping is a web/DOM concern. React Native <Text> renders
      // apostrophes/quotes literally, so this rule produces only false positives.
      "react/no-unescaped-entities": "off",
    },
  },
]);
