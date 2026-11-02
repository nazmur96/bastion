import { describe, expect, it } from 'vitest'
import { classifyInfraCommand, infraGateDecision } from './fork-devops-command-gate'

const cls = (line: string) => classifyInfraCommand(line).class

describe('classifyInfraCommand', () => {
  it('lets reading and planning through', () => {
    for (const line of [
      'terraform -chdir=infra/dev plan -out=tfplan',
      'terraform show -json tfplan',
      'kubectl get pods -A',
      'kubectl diff -f deploy/svc.yaml',
      'helm template charts/web',
      'aws sts get-caller-identity',
      'aws ec2 describe-instances --region eu-central-1',
      'aws s3 ls',
      'argocd app diff podinfo',
      'git status && ls -la'
    ]) {
      expect(cls(line), line).toBe('safe')
    }
  })

  it('marks changes, including a reviewed terraform plan file', () => {
    for (const line of [
      'terraform apply tfplan',
      'kubectl apply -f deploy/',
      'kubectl rollout restart deploy/podinfo',
      'helm upgrade --install web charts/web',
      'aws ec2 run-instances --image-id ami-1',
      'aws s3 cp build/ s3://site --recursive',
      'argocd app sync podinfo'
    ]) {
      expect(cls(line), line).toBe('change')
    }
  })

  it('marks destruction', () => {
    for (const line of [
      'terraform destroy -auto-approve',
      'terraform apply -destroy',
      'kubectl delete ns staging',
      'helm uninstall web',
      'aws ec2 terminate-instances --instance-ids i-1',
      'aws s3 rb s3://bucket --force',
      'eksctl delete cluster --name dev'
    ]) {
      expect(cls(line), line).toBe('destroy')
    }
  })

  it('refuses a terraform apply that skips the reviewed plan', () => {
    expect(cls('terraform apply -auto-approve')).toBe('apply-unplanned')
    expect(cls('cd infra && terraform -chdir=dev apply')).toBe('apply-unplanned')
  })

  it('sees through wrappers, env prefixes and chains', () => {
    expect(cls(`mise exec -- sh -c 'kubectl delete pod web-0'`)).toBe('destroy')
    expect(cls('AWS_PROFILE=prod aws ec2 terminate-instances --instance-ids i-1')).toBe('destroy')
    expect(cls('terraform plan -out=tfplan && terraform apply tfplan')).toBe('change')
    expect(classifyInfraCommand('ls; kubectl delete pod x').command).toBe('kubectl delete pod x')
    expect(classifyInfraCommand('helm uninstall web').target).toBe('cluster')
  })
})

describe('infraGateDecision', () => {
  const v = (line: string) => classifyInfraCommand(line)

  it('runs everything freely on a local sandbox', () => {
    expect(infraGateDecision(v('terraform destroy'), 'local', 'floci')).toBeNull()
    expect(infraGateDecision(v('terraform apply -auto-approve'), 'local', 'floci')).toBeNull()
  })

  it('asks for changes on real infrastructure and flags production', () => {
    expect(infraGateDecision(v('kubectl get pods'), 'prod', 'eks prod')).toBeNull()
    expect(infraGateDecision(v('kubectl apply -f x.yaml'), 'normal', 'kind-dev')?.decision).toBe(
      'ask'
    )
    const prod = infraGateDecision(v('kubectl delete ns web'), 'prod', 'eks prod')
    expect(prod?.decision).toBe('ask')
    expect(prod?.reason).toMatch(/^PRODUCTION · Destroys real infrastructure/)
  })

  it('refuses an apply without a reviewed plan and says how to do it', () => {
    const refusal = infraGateDecision(v('terraform apply -auto-approve'), 'normal', 'default')
    expect(refusal?.decision).toBe('deny')
    expect(refusal?.reason).toContain('terraform plan -out=tfplan')
  })
})
