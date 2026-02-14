"use strict";

module.exports = function dockerWorkflow(config) {
  const ghUser = config.author.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `name: Build and Push Docker Image

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository_owner }}/nexus-plugin-${config.slug}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: \${{ github.event_name != 'pull_request' }}
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}

      - name: Output digest
        if: github.event_name != 'pull_request'
        run: |
          echo "## Docker Image Published" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "**Image:** \\\`\${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}\\\`" >> \$GITHUB_STEP_SUMMARY
          echo "**Digest:** \\\`\${{ steps.build.outputs.digest }}\\\`" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "Add this to your \\\`plugin.json\\\`:" >> \$GITHUB_STEP_SUMMARY
          echo "\\\`\\\`\\\`json" >> \$GITHUB_STEP_SUMMARY
          echo "\\"image_digest\\": \\"\${{ steps.build.outputs.digest }}\\"" >> \$GITHUB_STEP_SUMMARY
          echo "\\\`\\\`\\\`" >> \$GITHUB_STEP_SUMMARY

      - name: Validate manifest
        run: npx -y nexus-plugin-cli@latest validate .
        continue-on-error: true
`;
};
