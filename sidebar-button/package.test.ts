import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

it("uses only the public SDK and package-local source", async () => {
  const result = await experimental_scanPublicSdkOnly(
    fileURLToPath(new URL(".", import.meta.url)),
    { allow: [/^(react|react-dom|zod)$/] },
  );
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
