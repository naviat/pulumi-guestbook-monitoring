import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ClusterComponent } from "./components/cluster";
import { MonitoringComponent } from "./components/monitoring";
import { AppComponent } from "./components/app";

const cluster = new ClusterComponent("gke");

const k8sProvider = new k8s.Provider("k8s", {
  kubeconfig: cluster.kubeconfig,
});

const monitoring = new MonitoringComponent("monitoring", {
  provider: k8sProvider,
});

const app = new AppComponent("app", {
  provider: k8sProvider,
  helmRelease: monitoring.helmRelease,
});

export const clusterName = cluster.clusterName;
export const kubeconfig = pulumi.secret(cluster.kubeconfig);
export const guestbookUrl = app.guestbookUrl;
export const grafanaUrl = monitoring.grafanaUrl;
export const grafanaPassword = monitoring.grafanaPassword;
export const prometheusUrl = monitoring.prometheusUrl;
