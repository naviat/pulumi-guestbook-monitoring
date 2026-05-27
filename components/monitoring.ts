import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { guestbookDashboard } from "../dashboards/guestbook";

export interface MonitoringComponentArgs {
  provider: k8s.Provider;
}

export class MonitoringComponent extends pulumi.ComponentResource {
  public readonly helmRelease: k8s.helm.v3.Release;
  public readonly grafanaUrl: pulumi.Output<string>;
  public readonly grafanaPassword: pulumi.Output<string>;
  public readonly prometheusUrl: pulumi.Output<string>;

  constructor(
    name: string,
    args: MonitoringComponentArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("px:index:MonitoringComponent", name, {}, opts);

    const ns = new k8s.core.v1.Namespace(
      `${name}-ns`,
      { metadata: { name: "monitoring" } },
      { provider: args.provider, parent: this }
    );

    const adminPassword = new random.RandomPassword(
      `${name}-grafana-pw`,
      { length: 20, special: false },
      { parent: this }
    );

    const release = new k8s.helm.v3.Release(
      `${name}-kps`,
      {
        chart: "kube-prometheus-stack",
        version: "85.3.3",
        namespace: ns.metadata.name,
        repositoryOpts: {
          repo: "https://prometheus-community.github.io/helm-charts",
        },
        values: {
          alertmanager: { enabled: false },
          grafana: {
            adminPassword: adminPassword.result,
            service: { type: "LoadBalancer" },
            sidecar: {
              dashboards: {
                enabled: true,
                label: "grafana_dashboard",
                labelValue: "1",
              },
            },
          },
          prometheus: {
            service: { type: "LoadBalancer" },
            prometheusSpec: {
              retention: "24h",
              storageSpec: {},
              serviceMonitorSelectorNilUsesHelmValues: false,
            },
          },
        },
      },
      {
        provider: args.provider,
        parent: this,
        dependsOn: [ns],
      }
    );

    const grafanaSvc = k8s.core.v1.Service.get(
      `${name}-grafana-svc`,
      pulumi.interpolate`monitoring/${release.status.name}-grafana`,
      { provider: args.provider, parent: this, dependsOn: [release] }
    );

    const prometheusSvc = k8s.core.v1.Service.get(
      `${name}-prometheus-svc`,
      pulumi.interpolate`monitoring/${release.status.name}-ku-prometheus`,
      { provider: args.provider, parent: this, dependsOn: [release] }
    );

    new k8s.core.v1.ConfigMap(
      `${name}-guestbook-dashboard`,
      {
        metadata: {
          name: "guestbook-dashboard",
          namespace: ns.metadata.name,
          labels: { grafana_dashboard: "1" },
        },
        data: {
          "guestbook-dashboard.json": JSON.stringify(guestbookDashboard),
        },
      },
      { provider: args.provider, parent: this, dependsOn: [release] }
    );

    this.helmRelease = release;
    this.grafanaUrl = grafanaSvc.status.apply(s => {
      const ip = s.loadBalancer?.ingress?.[0]?.ip;
      return ip ? `http://${ip}` : "<pending — kubectl get svc -n monitoring>";
    });
    this.grafanaPassword = pulumi.secret(adminPassword.result);
    this.prometheusUrl = prometheusSvc.status.apply(s => {
      const ip = s.loadBalancer?.ingress?.[0]?.ip;
      return ip ? `http://${ip}:9090` : "<pending — kubectl get svc -n monitoring>";
    });

    this.registerOutputs({
      helmRelease: this.helmRelease,
      grafanaUrl: this.grafanaUrl,
      grafanaPassword: this.grafanaPassword,
      prometheusUrl: this.prometheusUrl,
    });
  }
}
