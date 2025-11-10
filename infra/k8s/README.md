# Kubernetes Manifests

This directory contains Kubernetes manifests and Helm charts for deploying CallFabric.

## Structure

- `manifests/` - Raw Kubernetes YAML manifests
- `helm/` - Helm charts (if using Helm)

## Usage

```bash
# Apply manifests
kubectl apply -f manifests/

# Or use Helm
helm install callfabric ./helm/callfabric
```

## Notes

- Customize manifests based on your cluster configuration
- Use secrets management (e.g., Sealed Secrets, External Secrets Operator)
- Consider using a GitOps tool like ArgoCD or Flux
