FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src/

ENV NODE_ENV=production

EXPOSE 3000

# Pass EBAY_APP_ID, EBAY_CERT_ID, EBAY_SANDBOX (and optional EBAY_API_KEY, EBAY_MARKETPLACE_ID) at runtime
# e.g. docker run --env-file .env -p 3000:3000 ebay-automation
CMD ["node", "src/server.js"]
