FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8765 MINGDAN_DATABASE=/data/mingdan-public.sqlite
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --chown=node:node sites-mingdan/server ./sites-mingdan/server
COPY --chown=node:node sites-mingdan/public/prototype ./sites-mingdan/public/prototype
COPY --chown=node:node sites-mingdan/drizzle ./sites-mingdan/drizzle
COPY --chown=node:node deploy/public-node.mjs deploy/public-backup.mjs ./deploy/
COPY --chown=node:node LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
USER node
EXPOSE 8765
CMD ["node", "deploy/public-node.mjs"]
