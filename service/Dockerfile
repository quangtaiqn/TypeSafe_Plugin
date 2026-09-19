FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8787
ENV MCP_HOST=0.0.0.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY src ./src
COPY service/src ./service/src

USER node
EXPOSE 8787
CMD ["node", "service/src/main.mjs"]
