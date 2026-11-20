# Board: SvelteKit app (adapter-node) in a small Node image.
#
#   docker build --build-arg BOARD_VERSION=$(git rev-parse --short HEAD) -t board .
#   docker run -p 3000:3000 --env-file .env -e ORIGIN=https://board.example.internal board
#
# BOARD_VERSION is shown at the bottom of the sidebar. .git is not copied into the build,
# so without it the board shows "dev". In CI pass the commit, e.g.
#   GitHub Actions: --build-arg BOARD_VERSION=${GITHUB_SHA::8}
#   GitLab CI:      --build-arg BOARD_VERSION=$CI_COMMIT_SHORT_SHA

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ARG BOARD_VERSION=dev
ENV BOARD_VERSION=$BOARD_VERSION
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build
ARG BOARD_VERSION=dev
LABEL org.opencontainers.image.revision=$BOARD_VERSION
USER node
EXPOSE 3000
CMD ["node", "build"]
