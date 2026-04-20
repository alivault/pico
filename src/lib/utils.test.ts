import { describe, expect, it } from "vite-plus/test"

import { cn } from "@/lib/utils"

describe("cn", () => {
  it("merges tailwind classes predictably", () => {
    expect(cn("px-2 py-1", "px-4", undefined, false && "hidden")).toBe(
      "py-1 px-4"
    )
  })
})
