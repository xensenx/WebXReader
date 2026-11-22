"""Publish a Vite build to the WebXReader Static Space."""

import json
import os
import sys
from pathlib import Path

from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi, RepoFile, SpaceCard
from huggingface_hub._commit_api import _fetch_upload_modes
from huggingface_hub.errors import HfHubHTTPError


SPACE = "WebXReader/app"
README = "README.md"
INVENTORY = ".webxreader-build.json"
PROTECTED = {README.lower(), INVENTORY, ".gitattributes", ".gitignore"}
# Git blob IDs from the Space's initial Static HTML template.
STARTER_FILES = {
    "index.html": "b0c4b3666032a737f3903db53e6a8a9272483e28",
    "style.css": "114adf441e9032febb46bc056b2a8bb651075f0d",
}


class DeploymentError(Exception):
    pass


def is_build_path(path: str) -> bool:
    return (
        "\\" not in path
        and path.lower() not in PROTECTED
        and all(part.lower() not in {"", ".", "..", ".git"} for part in path.split("/"))
    )


def collect_build(output: Path) -> dict[str, Path]:
    if not output.is_dir():
        raise DeploymentError(f"Build output directory is missing: {output}")

    files = {}
    for file in sorted(output.rglob("*")):
        if file.is_symlink():
            raise DeploymentError("Build output contains a symbolic link.")
        if file.is_file():
            path = file.relative_to(output).as_posix()
            if not is_build_path(path):
                raise DeploymentError(f"Build output uses a reserved path: {path}")
            files[path] = file

    if "index.html" not in files or files["index.html"].stat().st_size == 0:
        raise DeploymentError(f"Build entry point is missing or empty: {output / 'index.html'}")
    return files


def publish(api: HfApi, files: dict[str, Path], source_sha: str) -> None:
    repo = {"repo_id": SPACE, "repo_type": "space"}
    space = api.repo_info(**repo, revision="main")
    if space.sdk != "static" or not space.sha:
        raise DeploymentError(f"Expected an existing Static HTML Space at {SPACE}.")

    snapshot = {**repo, "revision": space.sha}
    remote = {
        entry.path: entry.blob_id
        for entry in api.list_repo_tree(**snapshot, recursive=True)
        if isinstance(entry, RepoFile)
    }

    card = SpaceCard.load(api.hf_hub_download(**snapshot, filename=README))
    if card.data.get("app_build_command"):
        raise DeploymentError("Remove app_build_command from the Space README to serve the compiled site.")
    card.data.title = "WebXReader"
    card.data.sdk = "static"
    card.data.app_file = "index.html"

    if INVENTORY in remote:
        inventory_file = Path(api.hf_hub_download(**snapshot, filename=INVENTORY))
        try:
            inventory = json.loads(inventory_file.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            inventory = None
        if (
            not isinstance(inventory, list)
            or "index.html" not in inventory
            or not all(isinstance(path, str) and is_build_path(path) for path in inventory)
        ):
            raise DeploymentError("The Space build inventory is invalid. Review it before deploying again.")
        managed = set(inventory)
    else:
        managed = {path for path, blob in STARTER_FILES.items() if remote.get(path) == blob}

    collisions = files.keys() & (remote.keys() - managed)
    if collisions:
        raise DeploymentError(f"Build paths conflict with unmanaged Space files: {', '.join(sorted(collisions))}")

    stale = sorted((managed & remote.keys()) - files.keys())
    build_additions = [CommitOperationAdd(path, file) for path, file in files.items()]
    additions = build_additions + [
        CommitOperationAdd(README, str(card).encode("utf-8")),
        CommitOperationAdd(INVENTORY, (json.dumps(sorted(files), indent=2) + "\n").encode("utf-8")),
    ]

    # Use the pinned Hub client's preupload check so the Space applies its own .gitignore rules.
    # create_commit reuses these results and still checks the parent before updating main.
    _fetch_upload_modes(
        additions=additions,
        **repo,
        headers=api._build_hf_headers(),
        revision="main",
        endpoint=api.endpoint,
    )
    ignored = sorted(
        op.path_in_repo for op in build_additions if op._upload_mode == "lfs" and op._should_ignore
    )
    if ignored:
        raise DeploymentError(f"The Space's .gitignore excludes LFS build files: {', '.join(ignored)}")

    operations = [*additions, *(CommitOperationDelete(path) for path in stale)]

    # Publish the whole update atomically and reject changes made since reading the Space.
    print(f"Syncing {len(files)} build files and removing {len(stale)} obsolete files in {SPACE}.", flush=True)
    commit = api.create_commit(
        **repo,
        revision="main",
        parent_commit=space.sha,
        operations=operations,
        commit_message=f"Deploy WebXReader {source_sha}",
    )
    print(f"Space revision: {commit.commit_url}")


def main() -> None:
    try:
        output, source_sha = sys.argv[1:]
        files = collect_build(Path(output))
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise DeploymentError("HF_TOKEN is missing. Configure the GitHub Actions repository secret.")
        publish(HfApi(endpoint="https://huggingface.co", token=token), files, source_sha)
    except DeploymentError as error:
        sys.exit(str(error))
    except HfHubHTTPError as error:
        status = error.response.status_code
        if status in {401, 403, 404}:
            sys.exit(f"Hugging Face returned HTTP {status}. Check {SPACE} and HF_TOKEN write access.")
        if status in {409, 412}:
            sys.exit(f"Hugging Face rejected a concurrent update (HTTP {status}). Run the deployment again.")
        sys.exit(f"Hugging Face rejected the deployment (HTTP {status}).")
    except Exception as error:
        # Avoid dumping request headers or remote response bodies into Actions logs.
        sys.exit(f"Hugging Face deployment failed ({type(error).__name__}).")


if __name__ == "__main__":
    main()
