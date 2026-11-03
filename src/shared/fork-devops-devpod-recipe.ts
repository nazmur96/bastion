import { parseDocument } from 'yaml'

/**
 * Fork F3: a per-workspace DevPod environment as an Orca VM recipe. The scripts go into the
 * repo (reviewed and committed like any file) so teammates with DevPod get the same option.
 * They need a POSIX shell: macOS, Linux, or WSL/Git Bash on Windows.
 */
export const DEVPOD_RECIPE_DIR = 'scripts/orca-vm'

const ID = [
  'id=$(printf "orca-%s" "${ORCA_WORKSPACE_ID:-workspace}" | tr "[:upper:]" "[:lower:]" | tr -c "a-z0-9-\\n" "-" | cut -c1-40)'
]

/** The connection Orca opens: DevPod adds `<id>.devpod` to ~/.ssh/config and clones to /workspaces/<id>. */
const PRINT_RESULT = [
  'printf \'{"schemaVersion":1,"connection":{"type":"ssh","target":{"label":"%s","configHost":"%s.devpod","host":"%s.devpod","port":22,"username":""},"projectRoot":"/workspaces/%s"}}\\n\' "$id" "$id" "$id" "$id"'
]

function script(lines: string[]): string {
  return [
    '#!/bin/sh',
    '# Written by Bastion: a DevPod dev container for this Orca workspace.',
    'set -eu',
    ...lines,
    ''
  ].join('\n')
}

export const DEVPOD_RECIPE_SCRIPTS: Record<string, string> = {
  'devpod-create.sh': script([
    ...ID,
    '# DevPod output goes to stderr: stdout carries only the JSON result Orca reads.',
    'devpod up "${ORCA_REPO_URL:-$ORCA_REPO_PATH}" --id "$id" --ide none ${ORCA_REPO_BRANCH:+--branch "$ORCA_REPO_BRANCH"} >&2',
    ...PRINT_RESULT
  ]),
  'devpod-suspend.sh': script([...ID, 'devpod stop "$id" >&2']),
  'devpod-resume.sh': script([...ID, 'devpod up "$id" --ide none >&2', ...PRINT_RESULT]),
  'devpod-destroy.sh': script([...ID, 'devpod delete "$id" --force >&2'])
}

export const DEVPOD_RECIPE = {
  id: 'devpod',
  name: 'DevPod dev container',
  description:
    "This repo's devcontainer.json on your DevPod provider (Docker, Podman, SSH, cloud).",
  create: `sh ./${DEVPOD_RECIPE_DIR}/devpod-create.sh`,
  suspend: `sh ./${DEVPOD_RECIPE_DIR}/devpod-suspend.sh`,
  resume: `sh ./${DEVPOD_RECIPE_DIR}/devpod-resume.sh`,
  destroy: `sh ./${DEVPOD_RECIPE_DIR}/devpod-destroy.sh`
}

/**
 * orca.yaml with the DevPod recipe added to `environmentRecipes`, comments and order kept.
 * Returns null when a recipe with that id is already there.
 */
export function withDevpodRecipe(orcaYaml: string): string | null {
  const doc = parseDocument(orcaYaml || '{}')
  const existing: unknown = doc.toJS()
  const recipes: unknown =
    existing !== null && typeof existing === 'object'
      ? Reflect.get(existing, 'environmentRecipes')
      : undefined
  if (
    Array.isArray(recipes) &&
    recipes.some(
      (recipe) =>
        recipe && typeof recipe === 'object' && Reflect.get(recipe, 'id') === DEVPOD_RECIPE.id
    )
  ) {
    return null
  }
  if (Array.isArray(recipes)) {
    doc.addIn(['environmentRecipes'], DEVPOD_RECIPE)
  } else {
    doc.set('environmentRecipes', [DEVPOD_RECIPE])
  }
  return doc.toString()
}
