import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Everything happens in the app; BB requires a server entry. */
export default async function plugin(_bb: BbPluginApi): Promise<void> {}
