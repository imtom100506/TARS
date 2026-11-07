FROM node:24.22.2-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY config ./config
COPY scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
ENV TARS_DATA_DIR=/app/data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
