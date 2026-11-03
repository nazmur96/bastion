import { useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * A folded group of Infra home cards. Opens itself once when it holds the next path step;
 * after that the person decides (the stepper opens it again when it scrolls to a card inside).
 */
export function InfraSection({
  id,
  title,
  summary,
  defaultOpen,
  children
}: {
  id: string
  title: string
  summary?: string
  defaultOpen: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDetailsElement>(null)
  const opened = useRef(false)
  useEffect(() => {
    if (defaultOpen && !opened.current && ref.current) {
      ref.current.open = true
      opened.current = true
    }
  }, [defaultOpen])
  return (
    <details
      ref={ref}
      id={id}
      className="group mb-3 rounded-lg border border-border"
      data-infra-section={id}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold select-none">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        {title}
        {summary ? (
          <span className="truncate text-xs font-normal text-muted-foreground">{summary}</span>
        ) : null}
      </summary>
      <div className="px-3 pb-1">{children}</div>
    </details>
  )
}
