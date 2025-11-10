# Terraform Infrastructure

This directory contains Terraform configurations for provisioning infrastructure on:

- DigitalOcean
- Hetzner
- S3-compatible object storage

## Structure

```
terraform/
├── modules/          # Reusable Terraform modules
├── environments/     # Environment-specific configs (dev, staging, prod)
└── main.tf          # Main configuration
```

## Usage

```bash
cd terraform/environments/dev
terraform init
terraform plan
terraform apply
```

## Providers

- DigitalOcean: Droplets, Spaces (S3-compatible), Load Balancers
- Hetzner: Cloud servers, Volumes
- AWS S3: Object storage (or compatible services)

## Notes

- Store secrets in Terraform Cloud, AWS Secrets Manager, or similar
- Use remote state backend (S3, Terraform Cloud, etc.)
- Follow infrastructure-as-code best practices
