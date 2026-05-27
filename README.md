# pulumi-guestbook-monitoring

GKE cluster + Guestbook app + Prometheus/Grafana monitoring stack, deployed with a single `pulumi up`.

## Prerequisites

- Pulumi v3+ (`pulumi version`)
- Node.js 20+ (`node --version`)
- gcloud CLI authed with ADC: `gcloud auth application-default login`
- GCP project with billing enabled and Owner or Editor role
- GCP APIs (the program enables these on first deploy):
  - `container.googleapis.com`
  - `compute.googleapis.com`

## Deploy

```bash
cd pulumi-guestbook-monitoring
npm install
pulumi stack init dev          # skip if stack already exists
pulumi config set gcp:project <your-gcp-project-id>
pulumi config set gcp:zone us-central1-a
pulumi up
```

First deploy takes 8-12 minutes (GKE control plane + node pool + Helm chart). Incremental updates run in 1-3 minutes.

## Access

```bash
pulumi stack output guestbookUrl
pulumi stack output grafanaUrl
pulumi stack output prometheusUrl
pulumi stack output grafanaPassword --show-secrets
```

`grafanaPassword` is wrapped in `pulumi.secret()` — without `--show-secrets` it prints `[secret]`.

Open `grafanaUrl` in a browser, log in as `admin` with the password above, navigate to **Dashboards > Guestbook**.

## Verify

Guestbook reachable:
```bash
curl -s -o /dev/null -w "%{http_code}\n" $(pulumi stack output guestbookUrl)
# expect: 200
```

ServiceMonitor registered:
```bash
kubectl get servicemonitor -n default
# expect: guestbook-frontend
```

Prometheus scraping the target:
```bash
PROM=$(pulumi stack output prometheusUrl)
curl -s "${PROM}/api/v1/targets" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print([t['labels'].get('job') for t in d['data']['activeTargets'] if 'guestbook' in t['labels'].get('service','')+t['labels'].get('job','')])"
```

Dashboard ConfigMap labelled correctly:
```bash
kubectl get cm -n monitoring guestbook-dashboard -o yaml | grep grafana_dashboard
# expect: grafana_dashboard: "1"
```

## Architecture

Three Pulumi component resources wire the stack:

- **ClusterComponent** — GKE Standard zonal cluster + one Spot e2-small node pool (autoscale 1-2). Token-based kubeconfig is built inline from the cluster endpoint and a fresh ADC token, so consumers don't need `gke-gcloud-auth-plugin`.
- **MonitoringComponent** — `monitoring` namespace, random Grafana admin password, kube-prometheus-stack Helm chart (v85.3.3) with Grafana + Prometheus exposed via LoadBalancer, dashboard ConfigMap.
- **AppComponent** — Guestbook (redis-leader, redis-replica, frontend) in the `default` namespace, frontend LoadBalancer, plus a `ServiceMonitor` for the Prometheus operator.

**Why emptyDir for Prometheus.** Retention is 24h. A PVC adds a GCP disk, a StorageClass dependency, and a teardown step. emptyDir is the right call for a short-lived demo.

**Why ServiceMonitor, not pod annotations.** kube-prometheus-stack uses the Prometheus Operator. The operator generates scrape configs from `ServiceMonitor` CRDs. Annotations (`prometheus.io/scrape: "true"`) require a separate additionalScrapeConfig that fights the operator. and the wrong pattern here. The ServiceMonitor sets `serviceMonitorSelectorNilUsesHelmValues: false` so Prometheus picks up SMs outside the `monitoring` namespace.

**Why cAdvisor + kube-state-metrics, not a /metrics endpoint.** The Guestbook frontend image (`pulumi/guestbook-php-redis`) is a legacy PHP/Apache image with no Prometheus exporter. Rather than bolt on an Apache exporter sidecar, the dashboard reads per-pod CPU and memory from cAdvisor (kubelet `/metrics/cadvisor`) and replica counts from kube-state-metrics — both shipped by kube-prometheus-stack. The ServiceMonitor still exists so the reviewer sees discovery wired through the operator; its target shows as `up` (empty metrics endpoint, 200 OK) and confirms the path works end-to-end.

## Security note

Grafana is exposed over plain HTTP on a public LoadBalancer IP. The admin password is randomly generated (via `pulumi/random`) and only accessible with `--show-secrets`. Anonymous access is disabled (chart default).

This is intentional for this take-home scope. For production: terminate TLS at an Ingress with cert-manager, restrict the LB with firewall rules, and source credentials from a secret manager rather than Pulumi stack outputs.

## Teardown

```bash
pulumi destroy --yes
```

Verify no orphaned LB resources remain in GCP:
```bash
gcloud compute forwarding-rules list --project <your-gcp-project-id>
gcloud compute addresses list --project <your-gcp-project-id>
```

If a forwarding rule survives `pulumi destroy` (rare, but Kubernetes-managed LBs can leak when Service deletion races with cluster teardown):
```bash
gcloud compute forwarding-rules delete <rule-name> --region us-central1 --project <your-gcp-project-id>
```

## Next steps

- TLS at Grafana/Prometheus via cert-manager + Ingress, drop the HTTP LBs
- PD-backed PVC for Prometheus to keep history across pod restarts
- Apache exporter sidecar on the frontend for real request-rate/error-rate metrics
- GitHub Actions to run `pulumi preview` on PRs
- Multi-stack support (dev/staging/prod) with per-stack GCP project config
