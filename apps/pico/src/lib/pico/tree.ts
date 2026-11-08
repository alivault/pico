import type { FlatTreeNode, TreeNode } from "@/lib/pico"

/**
 * Link the flat nodes of `/api/agent/tree` into a tree. The server sends a
 * flat list because a long agent is one chain thousands of entries deep, and
 * JSON of a nested tree that deep overflows the stack.
 */
export function buildTree(nodes: ReadonlyArray<Omit<TreeNode, "children">>) {
  const byId = new Map<string, TreeNode>()
  const roots: Array<TreeNode> = []
  for (const wireNode of nodes) {
    const node: TreeNode = { ...wireNode, children: [] }
    byId.set(node.entry.id, node)
    const parent = node.entry.parentId
      ? byId.get(node.entry.parentId)
      : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function flattenTree(tree: Array<TreeNode>) {
  const flatNodes: Array<FlatTreeNode> = []

  // A long linear agent is one deep chain, so walk it with a stack, not recursion.
  const stack: Array<[TreeNode, number]> = []
  for (let index = tree.length - 1; index >= 0; index -= 1) {
    stack.push([tree[index], 0])
  }

  while (stack.length > 0) {
    const [node, depth] = stack.pop()!
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
      streaming: Boolean(node.streaming),
      timestamp: entry.timestamp,
      type: entry.type,
      role,
      text: contentParts.filter(Boolean).join(" ").trim(),
      node,
    })

    const children = node.children || []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push([children[index], depth + 1])
    }
  }

  return flatNodes
}
