import type { WebToolCore } from "./web-tool-contract.d.ts"

export interface StandaloneWebToolCore extends WebToolCore {
  enabledToolNames: string[]
}

export declare function createStandaloneWebToolCore(): StandaloneWebToolCore
