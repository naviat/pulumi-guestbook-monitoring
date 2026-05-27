import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface AppComponentArgs {
  provider: k8s.Provider;
  helmRelease: k8s.helm.v3.Release;
}

export class AppComponent extends pulumi.ComponentResource {
  public readonly guestbookUrl: pulumi.Output<string>;

  constructor(
    name: string,
    args: AppComponentArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("px:index:AppComponent", name, {}, opts);

    const redisLeaderLabels = {
      app: "redis",
      role: "leader",
      tier: "backend",
    };

    new k8s.apps.v1.Deployment(
      "redis-leader",
      {
        metadata: { name: "redis-leader", namespace: "default" },
        spec: {
          selector: { matchLabels: redisLeaderLabels },
          replicas: 1,
          template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
              containers: [{
                name: "redis-leader",
                image: "redis",
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits:   { cpu: "100m", memory: "128Mi" },
                },
                ports: [{ containerPort: 6379 }],
              }],
            },
          },
        },
      },
      { parent: this, provider: args.provider }
    );

    new k8s.core.v1.Service(
      "redis-leader",
      {
        metadata: {
          name: "redis-leader",
          namespace: "default",
          labels: redisLeaderLabels,
        },
        spec: {
          type: "ClusterIP",
          selector: redisLeaderLabels,
          ports: [{ port: 6379, targetPort: 6379 }],
        },
      },
      { parent: this, provider: args.provider }
    );

    const redisReplicaLabels = {
      app: "redis",
      role: "replica",
      tier: "backend",
    };

    new k8s.apps.v1.Deployment(
      "redis-replica",
      {
        metadata: { name: "redis-replica", namespace: "default" },
        spec: {
          selector: { matchLabels: redisReplicaLabels },
          replicas: 1,
          template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
              containers: [{
                name: "redis-replica",
                image: "pulumi/guestbook-redis-replica",
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits:   { cpu: "100m", memory: "128Mi" },
                },
                ports: [{ containerPort: 6379 }],
                env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
              }],
            },
          },
        },
      },
      { parent: this, provider: args.provider }
    );

    new k8s.core.v1.Service(
      "redis-replica",
      {
        metadata: {
          name: "redis-replica",
          namespace: "default",
          labels: redisReplicaLabels,
        },
        spec: {
          type: "ClusterIP",
          selector: redisReplicaLabels,
          ports: [{ port: 6379, targetPort: 6379 }],
        },
      },
      { parent: this, provider: args.provider }
    );

    const frontendLabels = {
      app: "guestbook",
      tier: "frontend",
    };

    new k8s.apps.v1.Deployment(
      "frontend",
      {
        metadata: { name: "frontend", namespace: "default" },
        spec: {
          selector: { matchLabels: frontendLabels },
          replicas: 1,
          template: {
            metadata: { labels: frontendLabels },
            spec: {
              containers: [{
                name: "php-redis",
                image: "pulumi/guestbook-php-redis",
                resources: {
                  requests: { cpu: "100m", memory: "100Mi" },
                  limits:   { cpu: "200m", memory: "200Mi" },
                },
                ports: [{ containerPort: 80 }],
                env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
              }],
            },
          },
        },
      },
      { parent: this, provider: args.provider }
    );

    const frontendService = new k8s.core.v1.Service(
      "frontend",
      {
        metadata: {
          name: "frontend",
          namespace: "default",
          labels: frontendLabels,
        },
        spec: {
          type: "LoadBalancer",
          selector: frontendLabels,
          ports: [{
            name: "http",
            port: 80,
            targetPort: 80,
          }],
        },
      },
      { parent: this, provider: args.provider }
    );

    this.guestbookUrl = frontendService.status.apply(status => {
      const ip = status.loadBalancer?.ingress?.[0]?.ip;
      return ip ? `http://${ip}` : "http://<pending — wait 60s and run: pulumi stack output guestbookUrl>";
    });

    new k8s.apiextensions.CustomResource(
      "guestbook-frontend-sm",
      {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: {
          name: "guestbook-frontend",
          namespace: "default",
          labels: frontendLabels,
        },
        spec: {
          selector: { matchLabels: frontendLabels },
          namespaceSelector: { matchNames: ["default"] },
          endpoints: [{ port: "http", interval: "30s" }],
        },
      },
      {
        parent: this,
        provider: args.provider,
        dependsOn: [args.helmRelease],
      }
    );

    this.registerOutputs({
      guestbookUrl: this.guestbookUrl,
    });
  }
}
