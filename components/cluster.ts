import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

export class ClusterComponent extends pulumi.ComponentResource {
  public readonly kubeconfig: pulumi.Output<string>;
  public readonly clusterName: pulumi.Output<string>;

  constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
    super("px:index:ClusterComponent", name, {}, opts);

    const containerApi = new gcp.projects.Service(
      `${name}-container-api`,
      { service: "container.googleapis.com", disableOnDestroy: false },
      { parent: this }
    );

    const computeApi = new gcp.projects.Service(
      `${name}-compute-api`,
      { service: "compute.googleapis.com", disableOnDestroy: false },
      { parent: this }
    );

    const cluster = new gcp.container.Cluster(
      `${name}-cluster`,
      {
        location: gcp.config.zone,
        initialNodeCount: 1,
        removeDefaultNodePool: true,
        releaseChannel: { channel: "REGULAR" },
        deletionProtection: false,
      },
      {
        parent: this,
        dependsOn: [containerApi, computeApi],
        ignoreChanges: ["nodeConfig"],
      }
    );

    const nodePool = new gcp.container.NodePool(
      `${name}-nodes`,
      {
        cluster: cluster.name,
        location: cluster.location,
        autoscaling: { minNodeCount: 1, maxNodeCount: 2 },
        management: { autoRepair: true, autoUpgrade: true },
        nodeConfig: {
          spot: true,
          machineType: "e2-small",
          imageType: "COS_CONTAINERD",
          diskType: "pd-standard",
          diskSizeGb: 30,
          oauthScopes: [
            "https://www.googleapis.com/auth/cloud-platform",
          ],
        },
      },
      { parent: this, dependsOn: [cluster] }
    );

    const gcpConfig = gcp.organizations.getClientConfigOutput();

    this.kubeconfig = pulumi
      .all([cluster.name, cluster.endpoint, cluster.masterAuth, gcpConfig.accessToken])
      .apply(([clusterName, endpoint, masterAuth, accessToken]) => {
        const context = `${gcp.config.project}_${gcp.config.zone}_${clusterName}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
users:
- name: ${context}
  user:
    token: ${accessToken}
`;
      });

    this.clusterName = cluster.name;

    this.registerOutputs({
      kubeconfig: this.kubeconfig,
      clusterName: this.clusterName,
    });
  }
}
