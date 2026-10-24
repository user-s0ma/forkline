"""Forkline serving entrypoint (runs as a Nebius Serverless AI Endpoint).

Downloads the LoRA adapter from Object Storage, then replaces itself with
`vllm serve <base model> --enable-lora --lora-modules <name>=<path>`.
The OpenAI-compatible API listens on --port; Nebius puts bearer-token auth in front of it.

Unknown args are passed straight to vLLM.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys

ADAPTER_DIR = pathlib.Path("/models/adapter")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base-model", required=True)
    p.add_argument("--adapter-uri", required=True)
    p.add_argument("--lora-name", default="adapter")
    p.add_argument("--max-lora-rank", type=int, default=64)
    p.add_argument("--max-model-len", type=int, default=16384)
    p.add_argument("--mamba-ssm-cache-dtype", default="float32")
    p.add_argument("--port", type=int, default=8000)
    args, extra = p.parse_known_args()

    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from s3util import download_prefix

    print(f"[forkline] downloading adapter {args.adapter_uri}", flush=True)
    count = download_prefix(args.adapter_uri, ADAPTER_DIR)
    if count == 0 or not (ADAPTER_DIR / "adapter_config.json").exists():
        print("[forkline] adapter_config.json not found under the adapter URI", file=sys.stderr)
        sys.exit(2)

    cmd = [
        "vllm", "serve", args.base_model,
        "--host", "0.0.0.0",
        "--port", str(args.port),
        "--served-model-name", "base",
        "--trust-remote-code",
        "--enable-lora",
        "--lora-modules", f"{args.lora_name}={ADAPTER_DIR}",
        "--max-loras", "1",
        "--max-lora-rank", str(args.max_lora_rank),
        "--max-model-len", str(args.max_model_len),
        "--mamba-ssm-cache-dtype", args.mamba_ssm_cache_dtype,
        *extra,
    ]
    print("[forkline] exec " + " ".join(cmd), flush=True)
    os.execvp(cmd[0], cmd)


if __name__ == "__main__":
    main()
