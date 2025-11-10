#!/bin/bash
# Setup script for DigitalOcean App Platform deployment

set -e

echo "🚀 Setting up Hopwhistle for DigitalOcean App Platform"
echo ""

# Check if git is initialized
if [ ! -d .git ]; then
    echo "❌ Git repository not initialized"
    echo "   Run: git init"
    exit 1
fi

# Check if remote is set
if ! git remote get-url origin &>/dev/null; then
    echo "📦 Setting up GitHub remote..."
    git remote add origin https://github.com/bbarnes4318/hopwhistle.git
    echo "✓ Remote added"
fi

# Check if .do/app.yaml exists
if [ ! -f .do/app.yaml ]; then
    echo "❌ .do/app.yaml not found"
    echo "   Creating from template..."
    mkdir -p .do
    cp .do/deploy.template.yaml .do/app.yaml
    echo "✓ Created .do/app.yaml"
    echo "   ⚠️  Please review and customize .do/app.yaml before deploying"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Review .do/app.yaml configuration"
echo "  2. Commit and push to GitHub:"
echo "     git add ."
echo "     git commit -m 'Setup DigitalOcean deployment'"
echo "     git push -u origin main"
echo "  3. Go to https://cloud.digitalocean.com/apps"
echo "  4. Click 'Create App' and connect your GitHub repo"
echo "  5. DigitalOcean will detect .do/app.yaml automatically"
echo ""
echo "See DEPLOYMENT.md for detailed instructions"

