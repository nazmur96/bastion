import { describe, expect, it } from 'vitest'
import { planAsText, summarizeTerraformPlan } from './fork-terraform-plan'

const plan = {
  resource_changes: [
    {
      address: 'aws_s3_bucket.logs',
      type: 'aws_s3_bucket',
      change: { actions: ['create'], before: null, after: { bucket: 'logs' } }
    },
    {
      address: 'module.db.aws_db_instance.main',
      module_address: 'module.db',
      type: 'aws_db_instance',
      change: {
        actions: ['update'],
        before: { instance_class: 'db.t4g.micro', password: 'old', tags: { env: 'dev' } },
        after: { instance_class: 'db.t4g.small', password: 'new', tags: { env: 'dev' } },
        before_sensitive: { password: true },
        after_sensitive: { password: true },
        after_unknown: {}
      }
    },
    {
      address: 'aws_instance.web',
      type: 'aws_instance',
      change: {
        actions: ['delete', 'create'],
        before: { ami: 'ami-1', id: 'i-1' },
        after: { ami: 'ami-2' },
        after_unknown: { id: true }
      }
    },
    { address: 'aws_iam_role.ok', type: 'aws_iam_role', change: { actions: ['no-op'] } }
  ],
  output_changes: { url: { actions: ['update'] }, same: { actions: ['no-op'] } }
}

const summary = summarizeTerraformPlan(JSON.stringify(plan))

describe('terraform plan summary', () => {
  it('counts actions, treating delete+create as replace and skipping no-ops', () => {
    expect(summary.counts).toEqual({ create: 1, update: 1, replace: 1, delete: 0, read: 0 })
    expect(summary.resources.map((resource) => resource.module)).toEqual([
      'root',
      'module.db',
      'root'
    ])
    expect(summary.outputs).toEqual(['url'])
  })

  it('diffs leaf attributes, masks sensitive ones and marks unknowns', () => {
    expect(summary.resources[1].changes).toEqual([
      { path: 'instance_class', before: 'db.t4g.micro', after: 'db.t4g.small' },
      { path: 'password', before: '••••••', after: '••••••' }
    ])
    expect(summary.resources[2].changes).toEqual([
      { path: 'ami', before: 'ami-1', after: 'ami-2' },
      { path: 'id', before: 'i-1', after: '(known after apply)' }
    ])
  })

  it('never puts a sensitive value in the text for Claude', () => {
    const text = planAsText(summary)
    expect(text).toContain('Plan: 1 to add, 1 to change, 1 to replace, 0 to destroy.')
    expect(text).not.toContain('new')
  })

  it('reads drift made outside Terraform without counting it as planned change', () => {
    const drifted = summarizeTerraformPlan(
      JSON.stringify({
        resource_drift: [
          {
            address: 'aws_security_group.web',
            type: 'aws_security_group',
            change: {
              actions: ['update'],
              before: { ingress: '443' },
              after: { ingress: '443,22' }
            }
          }
        ]
      })
    )
    expect(drifted.counts.update).toBe(0)
    expect(drifted.drift[0].changes).toEqual([{ path: 'ingress', before: '443', after: '443,22' }])
  })

  it('survives bad JSON', () => {
    expect(summarizeTerraformPlan('nope').resources).toEqual([])
  })
})
