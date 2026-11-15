import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import { ObjectStorageRecipeForm } from './ObjectStorageRecipeForm'
import { ObjectStorageBindingForm } from './ObjectStorageBindingForm'
import { RecipeDirectoryCard } from './RecipeDirectoryCard'

/** Fork: Step 10.1 Recipes page. Reviewed source recipes, delivered to a local emulator. */
export function WorkspaceRecipesPage({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<RecipeSnapshot | null>(null)
  const [target, setTarget] = useState<CloudTarget | null>(null)
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    const load = async () => {
      const result = await window.api.cloudTargets?.read(worktreeId)
      if (current && result?.ok) {
        const selected = result.snapshot.targets.find(
          (item) => item.id === result.snapshot.selection?.targetId
        )
        setTarget(selected ?? null)
      }
    }
    void load()
    const unsubscribe = window.api.cloudTargets?.onChanged(() => void load())
    return () => {
      current = false
      unsubscribe?.()
    }
  }, [worktreeId])
  const open = async (): Promise<void> => {
    setError(null)
    const result = await window.api.cloudTargets?.recipes?.read({
      projectId: worktreeId,
      directory
    })
    if (result?.ok) {
      setSnapshot(result)
    } else {
      setError(result?.message ?? 'Recipes are unavailable in this client.')
    }
  }
  return (
    <div className="workspace-page scrollbar-sleek" data-testid="workspace-recipes">
      <header className="workspace-page-heading">
        <div>
          <div className="workspace-eyebrow">Environments & delivery</div>
          <h1>Recipes</h1>
          <p>
            Reviewed infrastructure recipes that generate ordinary Terraform into this project.
            Validate on this computer, then apply to a local Floci emulator for free.
          </p>
        </div>
      </header>
      {snapshot ? (
        <RecipeDirectoryCard
          projectId={worktreeId}
          snapshot={snapshot}
          target={target}
          onSnapshot={setSnapshot}
        />
      ) : (
        <>
          <ObjectStorageRecipeForm projectId={worktreeId} onCreated={setSnapshot} />
          <ObjectStorageBindingForm
            projectId={worktreeId}
            target={target}
            onCreated={setSnapshot}
          />
        </>
      )}
      <section className="workspace-card space-y-2">
        <h3>Open an existing recipe directory</h3>
        <div className="flex gap-2">
          <input
            aria-label="Recipe directory"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
            placeholder="infra/orders-assets"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
          />
          <Button variant="outline" disabled={!directory} onClick={() => void open()}>
            Open
          </Button>
          {snapshot && (
            <Button variant="ghost" onClick={() => setSnapshot(null)}>
              New recipe
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
