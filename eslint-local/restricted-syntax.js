import { builtinRules } from "eslint/use-at-your-own-risk";

export default {
  meta: { name: "syntax" },
  rules: {
    "restricted-syntax": builtinRules.get("no-restricted-syntax"),
    "design-restricted-syntax": builtinRules.get("no-restricted-syntax"),
  },
};
