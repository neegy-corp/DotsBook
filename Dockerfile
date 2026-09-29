FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY server ./server
COPY src ./src
ENV PORT=8080 HOST=0.0.0.0 DOTSBOOK_DB=/data/dotsbook.db
EXPOSE 8080
CMD ["node", "server/index.mjs"]
