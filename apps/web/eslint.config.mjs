import nextConfig from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/", "node_modules/", "data/", "playwright-report/"],
  },
  {
    rules: {
      // These patterns (setState in useEffect for data fetching and theme init)
      // are intentional in the existing codebase
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
