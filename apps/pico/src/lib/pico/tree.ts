import type { FlatTreeNode, TreeNode } from "@/lib/pico"

export function flattenTree(tree: Array<TreeNode>) {
  const flatNodes: Array<FlatTreeNode> = []

  // A long linear session is one deep chain, so walk it with a stack, not recursion.
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
