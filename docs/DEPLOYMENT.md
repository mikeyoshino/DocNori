# DocNory on the existing Contabo VPS

DocNory uses its own `docnory-production` Compose project and deployment account.
It shares only the existing `toystore-production_frontend` Docker network and
Caddy instance with the applications already on the VPS. It publishes no host
ports, does not create PostgreSQL, and does not change TrackZ services or data.
The production origin is `https://docnori.com` (the visible brand is DocNory).

The GitHub Actions workflow builds two Linux images, pushes them to GHCR, then
connects over SSH and calls only `/usr/local/sbin/docnory-deploy`. The VPS
script replaces the DocNory images by immutable digest, checks the app from
inside its nginx container, and restores the previous images if an update
fails. In-progress QR signature pairings are held in relay memory and expire
when the relay container is replaced.

## 1. DNS and shared Caddy route

Set the `A` record for `docnori.com` to the Contabo VPS. If Cloudflare proxy is
enabled, use Full (strict) TLS so Cloudflare also validates Caddy's certificate.
Keep the existing Toy Store and TrackZ DNS records unchanged.

The reviewed site block is [`deploy/Caddyfile.docnory`](../deploy/Caddyfile.docnory).
Append that block to the existing `/opt/toystore/Caddyfile` without replacing
its current site blocks. Update the SyToyV2 source Caddyfile as well so a future
Toy Store deployment retains this route. Validate the combined file with
`caddy validate` before reloading the existing Caddy process. Caddy routes
`docnori.com` to the isolated `docnory-web:8080` alias on its shared network.

## 2. One-time DocNory VPS setup

Run these commands from a checkout of the exact DocNory revision being deployed,
using the current VPS administrator SSH account and port. Do not copy secrets
into the Git repository.

```sh
scp -P <ssh-port> deploy/compose.production.yaml infra/nginx.conf \
  deploy/docnory-bootstrap deploy/docnory-deploy deploy/Caddyfile.docnory \
  <admin>@<vps>:/tmp/
ssh -p <ssh-port> <admin>@<vps>
```

On the VPS:

```sh
sudo install -d -o root -g root -m 0755 /opt/docnory
sudo install -o root -g root -m 0644 /tmp/compose.production.yaml /opt/docnory/compose.production.yaml
sudo install -o root -g root -m 0644 /tmp/nginx.conf /opt/docnory/nginx.conf
sudo install -o root -g root -m 0755 /tmp/docnory-bootstrap /usr/local/sbin/docnory-bootstrap
sudo install -o root -g root -m 0755 /tmp/docnory-deploy /usr/local/sbin/docnory-deploy
sudo /usr/local/sbin/docnory-bootstrap https://docnori.com
```

This creates `/etc/docnory/compose.env`, group `docnory`, and account
`docnory-deploy`. It leaves existing configuration untouched on repeated runs.
The initial image fields are empty until the first GitHub Actions deployment.

Install an SSH public key dedicated to `docnory-deploy` in
`/home/docnory-deploy/.ssh/authorized_keys`, with directory mode `0700`, file
mode `0600`, and ownership `docnory-deploy:docnory`. Give it a narrow sudo rule:

```text
docnory-deploy ALL=(root) NOPASSWD: /usr/local/sbin/docnory-deploy *
```

Save this as `/etc/sudoers.d/docnory-deploy`, owned by root with mode `0440`,
and run `sudo visudo -cf /etc/sudoers.d/docnory-deploy`. Do not add this user
to the Docker or sudo groups. Use a verified SSH host-key line in the GitHub
secret; never trust an unverified `ssh-keyscan` result as the only check.

If the GHCR packages are private, log Docker into GHCR **on the VPS** with a
token limited to `read:packages`, so the root-run deploy command can pull the
images. Public GHCR packages need no registry login. Do not place this token
in GitHub Actions or an environment file on this server.

## 3. Add the route without changing existing applications

After uploading `Caddyfile.docnory` to `/tmp` on the VPS, construct a candidate
from the **host** Caddyfile, which already contains the TrackZ route. The
running Caddy container may still have an older inode mounted at
`/etc/caddy/Caddyfile`, so do not reload from that path: doing so would drop
TrackZ's route until the full configuration is loaded again.

```sh
cat /opt/toystore/Caddyfile /tmp/Caddyfile.docnory > /tmp/Caddyfile.docnory-next
sudo docker cp /tmp/Caddyfile.docnory-next \
  toystore-production-caddy-1:/tmp/Caddyfile.docnory-next
sudo docker exec toystore-production-caddy-1 \
  caddy validate --config /tmp/Caddyfile.docnory-next
sudo cp /opt/toystore/Caddyfile /opt/toystore/Caddyfile.before-docnory
sudo sh -c 'cat /tmp/Caddyfile.docnory-next > /opt/toystore/Caddyfile'
sudo docker exec toystore-production-caddy-1 \
  caddy reload --config /tmp/Caddyfile.docnory-next
```

The host file is the source for the next container start; the explicit reload
loads the same full configuration into the currently running Caddy process.
Verify TrackZ immediately after reloading. Also add the same block to the
SyToyV2 repository's `deploy/Caddyfile` before its next release; otherwise
that release may remove the route.

## 4. GitHub repository and production environment

Push this project to a GitHub repository with `main` as its deployment branch.
The local working directory may need a Git repository and remote created first.
Create a `production` GitHub Environment with:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `VPS_HOST` | Contabo VPS IP or hostname |
| Variable | `VPS_PORT` | SSH port; optional, defaults to `22` |
| Variable | `VPS_USER` | `docnory-deploy` |
| Variable | `PRODUCTION_URL` | `https://docnori.com` |
| Secret | `VPS_SSH_PRIVATE_KEY` | Dedicated DocNory deploy key |
| Secret | `VPS_SSH_KNOWN_HOSTS` | Verified host-key line for the VPS and port |

Run **Actions → Deploy DocNory production → Run workflow** with branch `main`.
The existing `Verify` workflow runs tests on pushes. The deployment workflow
checks that `https://docnori.com/` responds with the DocNory page after the
VPS script finishes.

## 5. Verify without affecting TrackZ

```sh
sudo docker compose --env-file /etc/docnory/compose.env \
  -f /opt/docnory/compose.production.yaml ps
curl --fail --show-error https://docnori.com/robots.txt
curl --fail --show-error https://api.trackz.sytoys.shop/health/ready
```

The compose project name, network, deploy account, lock, and configuration
paths are distinct from TrackZ. A failed DocNory deployment never runs TrackZ
Compose commands.
