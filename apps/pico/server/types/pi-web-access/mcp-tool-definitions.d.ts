export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: unknown
  annotations: {
    readOnlyHint: boolean
    destructiveHint?: boolean
    openWorldHint: boolean
  }
}

export declare const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[]
