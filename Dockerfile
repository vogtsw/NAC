# NAC (NexusAgent-Cluster) Dockerfile
# Provides containerized sandbox isolation for secure agent execution

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nac && \
    adduser -u 1001 -S nac -G nac

# Install system dependencies (minimal)
RUN apk add --no-cache \
    git \
    curl \
    bash \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm@8

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy application code
COPY --chown=nac:nac . .

# Create necessary directories with proper permissions
RUN mkdir -p /app/src /app/tests /app/docs /app/config /app/memory /app/skills /app/temp && \
    chown -R nac:nac /app

# Create temporary directory with restricted permissions
RUN mkdir -p /tmp/nac && \
    chown -R nac:nac /tmp/nac && \
    chmod 1777 /tmp/nac

# Switch to non-root user
USER nac

# Set environment variables
ENV NODE_ENV=production
ENV NAC_SANDBOX_LEVEL=moderate
ENV NAC_ENABLE_AUDIT_LOG=true

# Expose port (if using API server)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["pnpm", "cli", "chat"]
