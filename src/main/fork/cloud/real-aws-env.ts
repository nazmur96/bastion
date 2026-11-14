import { homedir } from 'node:os'
import { join } from 'node:path'
export function realAwsProfileEnv(
  profileName: string,
  region: string,
  owner: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of [
    'PATH',
    'SystemRoot',
    'SystemDrive',
    'WINDIR',
    'PATHEXT',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LD_LIBRARY_PATH',
    'NIX_LD',
    'NIX_LD_LIBRARY_PATH',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
    'AWS_CA_BUNDLE'
  ]) {
    if (owner[name] !== undefined) {
      result[name] = owner[name]
    }
  }
  const home =
    process.platform === 'win32' ? (owner.USERPROFILE ?? homedir()) : (owner.HOME ?? homedir())
  return {
    ...result,
    HOME: home,
    USERPROFILE: home,
    AWS_CONFIG_FILE: join(home, '.aws', 'config'),
    AWS_SHARED_CREDENTIALS_FILE: join(home, '.aws', 'credentials'),
    AWS_PROFILE: profileName,
    AWS_DEFAULT_PROFILE: profileName,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_PAGER: '',
    AWS_MAX_ATTEMPTS: '1'
  }
}
