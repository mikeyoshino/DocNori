#!/usr/bin/env python3
"""Start the HTTPS member workspace with private .env credentials; never print them."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
config = root / ".env"
if not config.is_file():
    sys.exit("Missing .env. Configure Accounts settings first.")
env = os.environ.copy()
for line in config.read_text().splitlines():
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    if key.startswith(("Accounts__", "Templates__", "ACCOUNTS_")):
        env[key] = value.strip().strip("\"'")
required = ["Accounts__Google__ClientId", "Accounts__Google__ClientSecret",
            "Accounts__ConnectionString", "ACCOUNTS_DEV_DB_PASSWORD"]
if any(not env.get(key) for key in required):
    sys.exit("Missing local Accounts settings. See docs/document-templates-operations.md.")
# This helper is intentionally local only; never normalize a production origin here.
env["Accounts__PublicOrigin"] = env["PublicOrigin"] = "https://localhost:5443"
env["ASPNETCORE_ENVIRONMENT"] = "Development"
for setting, folder in [("Templates__StoragePath", "templates"),
                        ("Accounts__DataProtectionPath", "account-keys")]:
    path = root / ".local" / folder
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    env[setting] = str(path)
docker = shutil.which("docker") or "/usr/local/bin/docker"
subprocess.run([docker, "compose", "--env-file", str(config), "-f",
                str(root / "infra/compose.accounts-dev.yaml"), "up", "-d", "--wait"],
               cwd=root, env=env, check=True)
print("Opening local workspace at https://localhost:5443/templates", flush=True)
try:
    result = subprocess.run(["dotnet", "run", "--no-launch-profile", "--project",
                             "src/SabuySign.Host", "--urls", "https://localhost:5443"],
                            cwd=root, env=env)
    sys.exit(result.returncode)
except KeyboardInterrupt:
    pass
