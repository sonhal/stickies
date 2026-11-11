# Environment for running the board against scripts/fake-gitlab.mjs. Source it: `. scripts/dev-env.sh`
export GITLAB_URL=http://localhost:4010
export GITLAB_GROUP=acme/platform
export GITLAB_OAUTH_CLIENT_ID=fake-client
export GITLAB_OAUTH_CLIENT_SECRET=fake-secret
export SESSION_SECRET=fake-session-secret-0123456789abcdefghijkl
export GITLAB_TOKEN=fake-kiosk-token
export KIOSK_KEY=fake-kiosk-key-0123456789abcdef
