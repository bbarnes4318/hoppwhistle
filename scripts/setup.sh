#!/bin/bash
# Setup script for CallFabric monorepo

set -e

echo "🚀 Setting up CallFabric monorepo..."

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it first:"
    echo "   npm install -g pnpm"
    exit 1
fi

# Check pnpm version
PNPM_VERSION=$(pnpm --version | cut -d. -f1)
if [ "$PNPM_VERSION" -lt 8 ]; then
    echo "❌ pnpm version 8 or higher is required. Current version: $(pnpm --version)"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Setup Husky
echo "🐕 Setting up Husky..."
pnpm prepare

# Copy env.example files to .env
echo "📝 Setting up environment files..."
for dir in apps/*/; do
    if [ -f "${dir}env.example" ]; then
        if [ ! -f "${dir}.env" ]; then
            cp "${dir}env.example" "${dir}.env"
            echo "   Created ${dir}.env"
        else
            echo "   ${dir}.env already exists, skipping"
        fi
    fi
done

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Review and update .env files in apps/*/"
echo "  2. Start Docker services: make docker-up"
echo "  3. Start development: pnpm dev"

