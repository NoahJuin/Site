FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data && chown node:node /data
ENV DATABASE_PATH=/data/shop.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["npm", "start"]
