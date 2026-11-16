import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { VerifyRequest } from '../../../shared/fork-delivery/operations-contract'
import { logExcerpt } from '../../../shared/fork-delivery/log-excerpt'
import { runbookDraft } from '../../../shared/fork-delivery/runbook-draft'
import { runJourneyCheck, verificationStore } from './journey-check'
import { RunbookError, createRunbook, listRunbooks } from './runbook-files'
import type { DiagnosisDeps } from './workload-diagnosis'

const DIGEST = `sha256:${'c'.repeat(64)}`
const request: VerifyRequest = {
  projectId: 'p',
  repository: 'example/spike',
  workflow: 'build.yml',
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  application: 'spike-app',
  applicationNamespace: 'argocd',
  revision: null,
  check: { service: 'spike-app', port: 8080, path: '/', expect: 'version: 6' },
  kind: 'check',
  runbook: null
}
function deps(body: { ok: boolean; out: string }): { value: DiagnosisDeps; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    value: {
      kubectl: async (args) => {
        calls.push(args)
        if (args.includes('--raw')) {
          return { ...body, code: body.ok ? 'ok' : 'failed' }
        }
        if (args.includes('applications.argoproj.io')) {
          return {
            ok: true,
            code: 'ok',
            out: JSON.stringify({ spec: { destination: { namespace: 'spike' } } })
          }
        }
        if (args.includes('pods')) {
          return {
            ok: true,
            code: 'ok',
            out: JSON.stringify({
              items: [
                {
                  metadata: { name: 'pod' },
                  status: {
                    containerStatuses: [
                      {
                        name: 'web',
                        ready: true,
                        restartCount: 0,
                        imageID: `ghcr.io/example/spike@${DIGEST}`,
                        state: { running: {} }
                      }
                    ]
                  }
                }
              ]
            })
          }
        }
        return { ok: true, code: 'ok', out: '{"items":[]}' }
      },
      imageLabels: async () => ({
        labels: { 'org.opencontainers.image.revision': 'd'.repeat(40) },
        reason: null
      })
    }
  }
}
const directories: string[] = []
async function temp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bastion-ops-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('journey checks', () => {
  it('passes on the expected text through the service proxy and records what ran', async () => {
    const { value, calls } = deps({ ok: true, out: '<p>version: 6</p>' })
    const run = await runJourneyCheck(request, value, 5)
    expect(calls.find((args) => args.includes('--raw'))).toEqual([
      'get',
      '--raw',
      '/api/v1/namespaces/spike/services/spike-app:8080/proxy/'
    ])
    expect(run).toMatchObject({
      passed: true,
      revision: 'd'.repeat(40),
      runningDigests: [DIGEST],
      target: 'spike/spike-app:8080/',
      at: 5
    })
  })
  it('fails on other content and on a request error, with the reason', async () => {
    expect(
      (await runJourneyCheck(request, deps({ ok: true, out: 'version: 5' }).value)).detail
    ).toBe('Response does not contain "version: 6"')
    const failed = await runJourneyCheck(
      request,
      deps({ ok: false, out: 'the server is currently unable to handle the request' }).value
    )
    expect(failed).toMatchObject({ passed: false })
    expect(failed.detail).toMatch(/^Request failed \(failed\)/)
  })
  it('keeps failed runs beside the passing retry, newest first', async () => {
    const store = verificationStore(await temp())
    const failed = await runJourneyCheck(request, deps({ ok: true, out: 'no' }).value, 1)
    const passed = await runJourneyCheck(
      { ...request, kind: 'drill', runbook: 'runbooks/crash.md' },
      deps({ ok: true, out: 'version: 6' }).value,
      2
    )
    await store.append('p', failed)
    await store.append('p', passed)
    expect((await store.list('p')).map((run) => [run.kind, run.passed, run.runbook])).toEqual([
      ['drill', true, 'runbooks/crash.md'],
      ['check', false, null]
    ])
    expect(await store.list('other')).toEqual([])
  })
})

describe('runbooks', () => {
  it('creates a new Markdown file, lists it by title and never overwrites it', async () => {
    const root = await temp()
    expect(await listRunbooks(root)).toEqual([])
    expect(await createRunbook(root, 'crash-loop', '# Crash loop\n\nSteps')).toBe(
      'runbooks/crash-loop.md'
    )
    expect(await listRunbooks(root)).toEqual([
      { path: 'runbooks/crash-loop.md', title: 'Crash loop' }
    ])
    await expect(createRunbook(root, 'crash-loop', '# Other')).rejects.toMatchObject({
      code: 'exists'
    })
    expect(await readFile(join(root, 'runbooks/crash-loop.md'), 'utf8')).toBe(
      '# Crash loop\n\nSteps\n'
    )
  })
  it('refuses a symlinked runbooks directory', async () => {
    const root = await temp()
    const elsewhere = await temp()
    await symlink(elsewhere, join(root, 'runbooks'))
    await expect(createRunbook(root, 'x', '# X')).rejects.toBeInstanceOf(RunbookError)
    await mkdir(join(elsewhere, 'sub'))
    await writeFile(join(elsewhere, 'y.md'), '# Y')
    await expect(listRunbooks(root)).rejects.toMatchObject({ code: 'unsafe-path' })
  })
  it('drafts from observed evidence and leaves the cause for the engineer', () => {
    const draft = runbookDraft({
      title: 'Crash loop',
      application: 'spike-app',
      diagnosis: {
        namespace: 'spike',
        rollouts: [],
        containers: [],
        events: [],
        logs: [],
        unknown: ['Pods: denied'],
        readAt: 0
      },
      check: null,
      runs: []
    })
    expect(draft).toContain('# Crash loop')
    expect(draft).toContain('- Pods: denied')
    expect(draft).toContain('_Write the cause the evidence above supports._')
  })
})

describe('log excerpts', () => {
  it('keeps the last lines within bounds and masks secret-looking values', () => {
    const raw = Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n')
    const excerpt = logExcerpt(`${raw}\npassword=hunter22\npostgres://app:s3cret@db:5432/x`)
    expect(excerpt.truncated).toBe(true)
    expect(excerpt.text.split('\n')).toHaveLength(100)
    expect(excerpt.text).not.toMatch(/hunter22|s3cret/)
    expect(excerpt.redactions).toBe(2)
  })
})
