FROM node:20-alpine AS base
WORKDIR /app

# Copy workspace root manifests first — lets Docker cache the install layer.
COPY package.json package-lock.json ./
COPY packages/cli/package.json ./packages/cli/
COPY packages/app/package.json ./packages/app/

# Install all workspace deps.
RUN npm ci --workspace=packages/app --workspace=packages/cli

# Copy source.
COPY packages/cli/ ./packages/cli/
COPY packages/app/ ./packages/app/

EXPOSE 3000
CMD ["node", "packages/app/src/server.js"]
