import type { FlatTreeNode, TreeNode } from "@/lib/pi-web"

export function flattenTree(tree: Array<TreeNode>) {
  const flatNodes: Array<FlatTreeNode> = []

  function visit(node: TreeNode, depth: number) {
    const entry = node.entry
    const role = entry.message?.role
    const label = node.label
    const contentParts = [
      label,
      role ? `${role}:` : "",
      entry.message?.text,
      entry.summary,
      entry.text,
      entry.message?.command,
      entry.modelId,
      entry.thinkingLevel,
      entry.name,
      entry.label,
      ...(entry.message?.toolCalls?.map(
        (toolCall) => toolCall.preview || toolCall.name || ""
      ) ?? []),
    ]

    flatNodes.push({
      id: entry.id,
      parentId: entry.parentId,
      depth,
      label,
      labelTimestamp: node.labelTimestamp,
      timestamp: entry.timestamp,
      type: entry.type,
      role,
      text: contentParts.filter(Boolean).join(" ").trim(),
      node,
    })

    for (const child of node.children || []) {
      visit(child, depth + 1)
    }
  }

  for (const node of tree) {
    visit(node, 0)
  }

  return flatNodes
}

export function filterFlatTree(nodes: Array<FlatTreeNode>, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return nodes

  return nodes.filter((node) =>
    node.text.toLowerCase().includes(normalizedQuery)
  )
}
