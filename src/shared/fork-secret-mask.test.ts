import { describe, expect, it } from 'vitest'
import { SECRET_MASK, isSopsEncrypted, maskSecrets, secretRanges } from './fork-secret-mask'

describe('secret mask', () => {
  it('masks values of secret-looking keys in env, YAML, JSON and tfvars', () => {
    const text = [
      'DB_PASSWORD=hunter2hunter',
      'export GITHUB_TOKEN="abc123def456"',
      'api_key: s3cr3tvalue',
      '"client_secret": "xyz-987-abc",',
      'db_password = "tfvarsSecret1"',
      'LOG_LEVEL=debug'
    ].join('\n')
    expect(maskSecrets(text)).toBe(
      [
        `DB_PASSWORD=${SECRET_MASK}`,
        `export GITHUB_TOKEN="${SECRET_MASK}"`,
        `api_key: ${SECRET_MASK}`,
        `"client_secret": "${SECRET_MASK}",`,
        `db_password = "${SECRET_MASK}"`,
        'LOG_LEVEL=debug'
      ].join('\n')
    )
  })

  it('leaves placeholders, references and SOPS ciphertext alone', () => {
    const text = [
      'PASSWORD=${DB_PASSWORD}',
      'token: "{{ .Values.token }}"',
      'secret: ENC[AES256_GCM,data:abc,iv:x,tag:y,type:str]',
      'password: changeme'
    ].join('\n')
    expect(maskSecrets(text)).toBe(text)
  })

  it('masks every value under a Kubernetes Secret data block, not other documents', () => {
    const text = [
      'kind: Secret',
      'metadata:',
      '  name: db',
      'data:',
      '  username: YWRtaW4=',
      '  host: ZGIuaW50ZXJuYWw=',
      'type: Opaque',
      '---',
      'kind: ConfigMap',
      'data:',
      '  host: db.internal'
    ].join('\n')
    expect(secretRanges(text).map((range) => range.line)).toEqual([5, 6])
  })

  it('finds token shapes anywhere and whole private keys', () => {
    const text = [
      'curl -H "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      'aws AKIAABCDEFGHIJKLMNOP',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAA',
      '-----END OPENSSH PRIVATE KEY-----'
    ].join('\n')
    const masked = maskSecrets(text)
    expect(masked).not.toContain('ghp_')
    expect(masked).not.toContain('AKIA')
    expect(masked).not.toContain('b3BlbnNzaC1rZXktdjEAAAAA')
  })

  it('recognises SOPS files', () => {
    expect(isSopsEncrypted('a: ENC[AES256_GCM,data:x]\nsops:\n  age: []\n')).toBe(true)
    expect(isSopsEncrypted('a: b\n')).toBe(false)
  })
})
