import type { DevopsSandboxKind } from './fork-devops-sandbox'
import type { LocalRunKind } from './fork-devops-local-runs'

/** Fork: the Launchpad — problems first ("give me a cluster"), each answered by one click. */
export type LaunchpadGroup = 'local' | 'demo' | 'machine' | 'scan' | 'real'

export type LaunchpadTile = {
  id: string
  group: LaunchpadGroup
  title: string
  blurb: string
  /** The CLI the tile runs; its status decides "ready" or "add it". */
  tool: string
  /** `null` = free. Real tiles only plan or dry-run; nothing billed is created by a click. */
  cost: string | null
  /** Demos install into the current cluster, so they need it to be a local one. */
  needsLocalCluster?: boolean
  /** Floci and vind already have a managed lifecycle: the tile drives it instead of a terminal. */
  sandbox?: DevopsSandboxKind
  /** Commands run in order in one workbench terminal; `{name}` is the workspace slug. */
  steps?: string[]
  /** What the tile leaves running, so End session can remove exactly that. */
  creates?: { kind: LocalRunKind; name: string }
}

export const LAUNCHPAD_GROUPS: readonly LaunchpadGroup[] = [
  'local',
  'demo',
  'machine',
  'scan',
  'real'
]

export const LAUNCHPAD_TILES: readonly LaunchpadTile[] = [
  {
    id: 'kind',
    group: 'local',
    title: 'Local Kubernetes · kind',
    blurb: 'A cluster in Docker or Podman with metrics-server, about a minute.',
    tool: 'kind',
    cost: null,
    creates: { kind: 'kind', name: '{name}-dev' },
    steps: [
      'kind create cluster --name {name}-dev',
      'kubectl --context kind-{name}-dev apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml',
      'kubectl --context kind-{name}-dev -n kube-system patch deployment metrics-server --type=json --patch-file "{metricsPatch}"',
      'kubectl cluster-info --context kind-{name}-dev'
    ]
  },
  {
    id: 'kind-multi',
    group: 'local',
    title: 'Local Kubernetes · kind, 3 nodes',
    blurb: 'One control plane and two workers, for scheduling and failover drills.',
    tool: 'kind',
    cost: null,
    creates: { kind: 'kind', name: '{name}-multi' },
    steps: [
      'kind create cluster --name {name}-multi --config "{kindConfig}"',
      'kubectl --context kind-{name}-multi apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml',
      'kubectl --context kind-{name}-multi -n kube-system patch deployment metrics-server --type=json --patch-file "{metricsPatch}"',
      'kubectl get nodes --context kind-{name}-multi'
    ]
  },
  {
    id: 'k3d',
    group: 'local',
    title: 'Local Kubernetes · k3d',
    blurb: 'Lightweight k3s in containers, the fastest start.',
    tool: 'k3d',
    cost: null,
    creates: { kind: 'k3d', name: '{name}-dev' },
    steps: ['k3d cluster create {name}-dev', 'kubectl cluster-info']
  },
  {
    id: 'vind',
    group: 'local',
    title: 'Local Kubernetes · vind',
    blurb: 'vCluster in Docker: pause and resume, LoadBalancers.',
    tool: 'vcluster',
    cost: null,
    sandbox: 'cluster'
  },
  {
    id: 'floci',
    group: 'local',
    title: 'Local AWS · Floci',
    blurb: 'S3, SQS, Lambda, DynamoDB… Terraform and Claude point at it.',
    tool: 'floci',
    cost: null,
    sandbox: 'aws'
  },
  {
    id: 'podinfo',
    group: 'demo',
    title: 'Demo app · podinfo',
    blurb: 'A small web app with health checks, metrics and a UI.',
    tool: 'helm',
    cost: null,
    needsLocalCluster: true,
    steps: [
      'helm upgrade --install podinfo oci://ghcr.io/stefanprodan/charts/podinfo -n podinfo --create-namespace --wait',
      'kubectl -n podinfo port-forward svc/podinfo 9898:9898'
    ]
  },
  {
    id: 'monitoring',
    group: 'demo',
    title: 'Observability · Prometheus + Grafana',
    blurb: 'kube-prometheus-stack, Grafana on localhost:3000.',
    tool: 'helm',
    cost: null,
    needsLocalCluster: true,
    steps: [
      'helm upgrade --install monitoring oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack -n monitoring --create-namespace --wait',
      'kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80'
    ]
  },
  {
    id: 'boutique',
    group: 'demo',
    title: 'Microservices · Online Boutique',
    blurb: 'Google’s 11-service shop with a load generator, on localhost:8081.',
    tool: 'kubectl',
    cost: null,
    needsLocalCluster: true,
    steps: [
      'kubectl create namespace boutique --dry-run=client -o yaml | kubectl apply -f -',
      'kubectl -n boutique apply -f https://raw.githubusercontent.com/GoogleCloudPlatform/microservices-demo/main/release/kubernetes-manifests.yaml',
      'kubectl -n boutique rollout status deploy/frontend --timeout=300s',
      'kubectl -n boutique port-forward svc/frontend 8081:80'
    ]
  },
  {
    id: 'devpod',
    group: 'machine',
    title: 'Dev container · DevPod',
    blurb: 'This repo’s devcontainer on your chosen provider.',
    tool: 'devpod',
    cost: null,
    steps: ['devpod up .']
  },
  {
    id: 'multipass',
    group: 'machine',
    title: 'Ubuntu VM · Multipass',
    blurb: 'A throwaway VM, 2 CPU / 4 GB, opened in a shell.',
    tool: 'multipass',
    cost: null,
    creates: { kind: 'multipass', name: '{name}-vm' },
    steps: ['multipass launch --name {name}-vm --cpus 2 --memory 4G', 'multipass shell {name}-vm']
  },
  {
    id: 'trivy',
    group: 'scan',
    title: 'Misconfigurations · Trivy',
    blurb: 'Terraform, Kubernetes, Helm and Dockerfiles against Trivy’s policies.',
    tool: 'trivy',
    cost: null,
    steps: ['trivy config --exit-code 0 .']
  },
  {
    id: 'checkov',
    group: 'scan',
    title: 'Policy as code · Checkov',
    blurb: 'Hundreds of CIS and cloud best-practice checks, compact output.',
    tool: 'checkov',
    cost: null,
    steps: ['checkov -d . --compact --quiet --soft-fail']
  },
  {
    id: 'kube-linter',
    group: 'scan',
    title: 'Kubernetes manifests · kube-linter',
    blurb: 'Probes, limits, security contexts and labels in your YAML.',
    tool: 'kube-linter',
    cost: null,
    steps: ['kube-linter lint .']
  },
  {
    id: 'terraform-plan',
    group: 'real',
    title: 'Terraform plan',
    blurb: 'See what this repo’s Terraform would change. Plan only.',
    tool: 'terraform',
    cost: 'plan only',
    steps: ['terraform -chdir={tfdir} init -input=false', 'terraform -chdir={tfdir} plan']
  },
  {
    id: 'eksctl',
    group: 'real',
    title: 'EKS cluster · eksctl',
    blurb: 'Prints the cluster config it would create. Dry run.',
    tool: 'eksctl',
    cost: 'dry run',
    steps: ['eksctl create cluster --name {name} --nodes 2 --dry-run']
  },
  {
    id: 'kops',
    group: 'real',
    title: 'Kubernetes on AWS · kops',
    blurb: 'Prints the cluster spec. Needs KOPS_STATE_STORE. Dry run.',
    tool: 'kops',
    cost: 'dry run',
    steps: ['kops create cluster --name {name}.k8s.local --zones eu-central-1a --dry-run -o yaml']
  }
]

/** Every tile's tool, once: what the Launchpad asks the main process to look up. */
export const LAUNCHPAD_TOOLS: readonly string[] = [
  ...new Set(LAUNCHPAD_TILES.map((tile) => tile.tool))
]

/** One terminal line: steps stop at the first failure. */
export function launchpadScript(
  tile: LaunchpadTile,
  values: { name: string; tfdir: string; files?: LaunchpadFiles }
): string | null {
  if (!tile.steps || tile.steps.length === 0) {
    return null
  }
  return tile.steps
    .map((step) =>
      step
        .replaceAll('{name}', values.name)
        .replaceAll('{tfdir}', values.tfdir)
        .replaceAll('{kindConfig}', values.files?.kindConfig ?? '')
        .replaceAll('{metricsPatch}', values.files?.metricsPatch ?? '')
    )
    .join(' && ')
}

/** One control plane (multi-control-plane kind clusters do not survive a Docker restart) and two workers. */
export const KIND_MULTI_NODE_CONFIG = [
  'kind: Cluster',
  'apiVersion: kind.x-k8s.io/v1alpha4',
  'nodes:',
  '  - role: control-plane',
  '  - role: worker',
  '  - role: worker',
  ''
].join('\n')

/**
 * kind's kubelets serve certificates not signed for their node IPs, so metrics-server
 * needs --kubelet-insecure-tls there (local clusters only). A patch file avoids shell quoting.
 */
export const METRICS_SERVER_KIND_PATCH =
  '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]\n'

/** Files the app writes to userData for tiles, so commands stay plain on every OS. */
export type LaunchpadFiles = { kindConfig: string; metricsPatch: string }

export function launchpadNeedsFiles(tile: LaunchpadTile): boolean {
  return tile.steps?.some((step) => /\{(kindConfig|metricsPatch)\}/.test(step)) ?? false
}
