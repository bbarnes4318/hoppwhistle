# Terraform main configuration
# This is a placeholder - customize based on your infrastructure needs

terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    hetzner = {
      source  = "hetznercloud/hetzner"
      version = "~> 1.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Provider configurations
provider "digitalocean" {
  # Configure via DIGITALOCEAN_TOKEN environment variable
}

provider "hetzner" {
  # Configure via HCLOUD_TOKEN environment variable
}

provider "aws" {
  # Configure via AWS credentials
  # Can be used for S3-compatible storage
}

# Add your infrastructure resources here

