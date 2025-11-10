# Hopwhistle Helm Chart

Helm chart for deploying Hopwhistle to Kubernetes.

## Installation

```bash
helm install hopwhistle ./infra/k8s/helm/hopwhistle \
  --namespace hopwhistle \
  --create-namespace \
  --set api.image.tag=v1.0.0 \
  --set web.image.tag=v1.0.0 \
  --set worker.image.tag=v1.0.0
```

## Configuration

See `values.yaml` for all configurable options.

## Upgrading

```bash
helm upgrade hopwhistle ./infra/k8s/helm/hopwhistle \
  --namespace hopwhistle \
  --set api.image.tag=v1.1.0
```
