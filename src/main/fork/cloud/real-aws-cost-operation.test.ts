import { afterEach, describe, expect, it, vi } from 'vitest'
import { callRealAwsOperation } from './real-aws-operations'
import { realAwsProfileEnv } from './real-aws-env'

const processHost = vi.hoisted(() => ({ run: vi.fn() }))
const direct = vi.hoisted(() => ({
  spawn: vi.fn(() => {
    throw new Error('Unexpected direct spawn')
  }),
  execFile: vi.fn(() => {
    throw new Error('Unexpected execFile')
  })
}))
vi.mock('@orca/process-host', () => ({ runProcess: processHost.run }))
vi.mock('node:child_process', () => direct)
const tool = {
  executable: '/fixture/installed/aws',
  version: '2.40.0',
  fingerprint: 'fixture',
  assertCurrent() {}
}
const query = {
  TimePeriod: { Start: '2026-11-01', End: '2026-11-14' },
  Granularity: 'DAILY',
  Metrics: ['UnblendedCost'],
  Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: ['000000000000'] } }
}
afterEach(() => {
  expect(direct.spawn).not.toHaveBeenCalled()
  expect(direct.execFile).not.toHaveBeenCalled()
  vi.clearAllMocks()
})
describe('RA-09 fixed Cost Explorer operation (process fake only)', () => {
  it('uses one fixed commercial-endpoint operation with literal account/date/metric input and one-attempt environment', async () => {
    processHost.run.mockResolvedValue({ code: 0, stdout: '{"ResultsByTime":[]}', stderr: '' })
    const env = realAwsProfileEnv('fixture-profile', 'us-west-2', { HOME: '/fixture' })
    await callRealAwsOperation(tool, env, '/fixture', 'cost-and-usage', query)
    expect(processHost.run).toHaveBeenCalledTimes(1)
    expect(processHost.run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: tool.executable,
        env: expect.objectContaining({ AWS_MAX_ATTEMPTS: '1' }),
        args: expect.arrayContaining([
          'ce',
          'get-cost-and-usage',
          '--region',
          'us-east-1',
          '--no-paginate',
          '--no-cli-pager'
        ])
      })
    )
    const args: unknown = processHost.run.mock.calls[0]?.[0]?.args
    expect(args).toContain(JSON.stringify(query))
  })
  it.each([
    { ...query, Granularity: 'MONTHLY' },
    { ...query, Metrics: ['BlendedCost'] },
    { ...query, GroupBy: [{ Type: 'TAG', Key: 'secret' }] },
    { ...query, BillingViewArn: 'arn:aws:billing::000000000000:billingview/fixture' },
    {
      ...query,
      Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: ['000000000000', '111111111111'] } }
    },
    { ...query, NextPageToken: 'renderer-chosen-token' }
  ])('refuses query widening before a process is created: %j', async (parameters) => {
    await expect(
      callRealAwsOperation(
        tool,
        { AWS_PROFILE: 'fixture', AWS_REGION: 'us-east-1' },
        '/fixture',
        'cost-and-usage',
        parameters
      )
    ).rejects.toThrow()
    expect(processHost.run).not.toHaveBeenCalled()
  })
})
