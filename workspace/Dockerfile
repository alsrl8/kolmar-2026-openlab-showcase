FROM node:25-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public
COPY n8n-workflows ./n8n-workflows
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.mjs"]
