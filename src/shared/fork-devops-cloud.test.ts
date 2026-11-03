import { describe, expect, it } from 'vitest'
import {
  countBudgets,
  parseCallerIdentity,
  scaffoldPlatformPrompt,
  usesStaticKeys
} from './fork-devops-cloud'

describe('cloud readiness', () => {
  it('flags long-lived keys but not SSO or temporary sessions', () => {
    const keys =
      '      Name    Value    Type    Location\naccess_key ****ABCD shared-credentials-file\n'
    const sso = 'access_key ****ABCD sso\n'
    expect(usesStaticKeys(keys, {})).toBe(true)
    expect(usesStaticKeys(keys, { AWS_SESSION_TOKEN: 'x' })).toBe(false)
    expect(usesStaticKeys(sso, {})).toBe(false)
    expect(usesStaticKeys('access_key <not set> None None\n', {})).toBe(false)
  })

  it('reads identity and budgets, and survives bad output', () => {
    expect(
      parseCallerIdentity('{"Account":"123456789012","Arn":"arn:aws:sts::1:assumed-role/A/b"}')
    ).toEqual({
      account: '123456789012',
      arn: 'arn:aws:sts::1:assumed-role/A/b'
    })
    expect(parseCallerIdentity('nope')).toBeNull()
    expect(countBudgets('{"Budgets":[{},{}]}')).toBe(2)
    expect(countBudgets('{}')).toBeNull()
  })

  it('asks Claude to write files only, never to apply', () => {
    const prompt = scaffoldPlatformPrompt({
      folder: 'platform',
      region: 'eu-central-1',
      appName: 'shop'
    })
    expect(prompt).toContain('platform/envs/dev')
    expect(prompt).toContain('Do not run terraform init, plan or apply')
  })
})
