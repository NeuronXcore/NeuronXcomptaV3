import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Receipt, BarChart3, FolderOpen, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GedTreeNode } from '@/types'

interface GedTreeProps {
  tree: GedTreeNode[]
  selectedNode: string | null
  onSelect: (nodeId: string) => void
}

const ICON_MAP: Record<string, typeof FileText> = {
  FileText,
  Receipt,
  BarChart3,
  FolderOpen,
  Calendar,
}

export default function GedTree({ tree, selectedNode, onSelect }: GedTreeProps) {
  return (
    <div className="space-y-0.5">
      {tree.map(node => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedNode={selectedNode}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function TreeNode({
  node,
  depth,
  selectedNode,
  onSelect,
}: {
  node: GedTreeNode
  depth: number
  selectedNode: string | null
  onSelect: (nodeId: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedNode === node.id
  const Icon = (node.icon && ICON_MAP[node.icon]) || FolderOpen

  const handleClick = () => {
    onSelect(node.id)
    if (hasChildren) setExpanded(prev => !prev)
  }

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors text-left',
          isSelected
            ? 'bg-primary/10 text-primary border-l-2 border-primary'
            : 'text-text-muted hover:text-text hover:bg-surface-hover'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {depth === 0 && <Icon size={14} className="shrink-0" />}
        <span className="truncate flex-1">{node.label}</span>
        {node.count > 0 && (
          <span className="text-[10px] text-text-muted bg-surface px-1.5 py-0.5 rounded-full shrink-0">
            {node.count}
          </span>
        )}
      </button>
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNode={selectedNode}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
