function timeseriesPanel(
  id: number,
  title: string,
  expr: string,
  unit: string,
): object {
  return {
    id,
    title,
    type: "timeseries",
    gridPos: { h: 8, w: 12, x: (id - 1) * 12, y: 0 },
    targets: [{ expr, legendFormat: "{{pod}}", refId: "A" }],
    fieldConfig: {
      defaults: {
        unit,
        custom: { lineWidth: 1, fillOpacity: 10 },
      },
    },
  };
}

function statPanel(id: number, title: string, expr: string): object {
  return {
    id,
    title,
    type: "stat",
    gridPos: { h: 4, w: 6, x: 0, y: 8 },
    targets: [{ expr, legendFormat: "", refId: "A" }],
    fieldConfig: { defaults: { unit: "short" } },
  };
}

export const guestbookDashboard = {
  title: "Guestbook",
  uid: "guestbook",
  schemaVersion: 39,
  version: 1,
  refresh: "30s",
  time: { from: "now-1h", to: "now" },
  panels: [
    timeseriesPanel(
      1,
      "Pod CPU Usage",
      `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="default", pod=~"frontend-.*", container!="POD", container!=""}[2m]))`,
      "cores",
    ),
    timeseriesPanel(
      2,
      "Pod Memory Usage",
      `sum by (pod) (container_memory_working_set_bytes{namespace="default", pod=~"frontend-.*", container!="POD", container!=""})`,
      "bytes",
    ),
    statPanel(
      3,
      "Replica Count",
      `kube_deployment_status_replicas{namespace="default", deployment="frontend"}`,
    ),
  ],
};
