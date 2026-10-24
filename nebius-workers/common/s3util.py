"""Small helpers for Nebius Object Storage (S3-compatible), shared by the train and serve images.

Credentials come from environment variables set by the Forkline app:
S3_ENDPOINT, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
"""

from __future__ import annotations

import os
import pathlib
from urllib.parse import urlparse

import boto3


def client():
    endpoint = os.environ["S3_ENDPOINT"]
    region = os.environ.get("S3_REGION", "eu-north1")
    return boto3.client("s3", endpoint_url=endpoint, region_name=region)


def parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc:
        raise ValueError(f"not an s3:// URI: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def download_file(uri: str, dest: pathlib.Path) -> None:
    bucket, key = parse_s3_uri(uri)
    dest.parent.mkdir(parents=True, exist_ok=True)
    client().download_file(bucket, key, str(dest))


def download_prefix(uri: str, dest: pathlib.Path) -> int:
    """Download every object under the prefix (treated as a directory). Returns the file count."""
    bucket, prefix = parse_s3_uri(uri)
    prefix = prefix.rstrip("/") + "/"
    s3 = client()
    count = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            rel = obj["Key"][len(prefix):]
            if not rel or rel.endswith("/"):
                continue
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, obj["Key"], str(target))
            count += 1
    return count


def upload_dir(src: pathlib.Path, uri: str, last: str | None = None) -> None:
    """Upload a directory under the prefix. `last` is uploaded at the end so its presence marks completion."""
    bucket, prefix = parse_s3_uri(uri)
    prefix = prefix.rstrip("/")
    s3 = client()
    files = sorted(p for p in src.rglob("*") if p.is_file())
    files.sort(key=lambda p: p.name == last)
    for path in files:
        key = f"{prefix}/{path.relative_to(src).as_posix()}"
        s3.upload_file(str(path), bucket, key)
