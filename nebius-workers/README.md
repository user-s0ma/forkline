# nebius-workers

Container images that Forkline runs on **Nebius Serverless AI**:

| Image | Runs as | What it does |
|---|---|---|
| `train/` | Serverless AI **Job** | LoRA fine-tuning of an NVIDIA Nemotron model (PEFT + TRL, bf16, 1 GPU). Reads a chat JSONL dataset from Object Storage and writes the adapter back to Object Storage. |
| `serve/` | Serverless AI **Endpoint** | vLLM (OpenAI-compatible) serving the base Nemotron model with the LoRA adapter loaded via `--enable-lora`. |

The Forkline app (`src/lib/nebius/`) creates the jobs and endpoints through the Nebius REST API
(`POST https://api.nebius.cloud/ai/v1/jobs`, `POST https://api.nebius.cloud/ai/v1/endpoints`) and
passes everything the containers need, so the images contain no per-model configuration.

## Supported base models

| Hugging Face id | Train (platform / preset) | Serve (platform / preset) |
|---|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16` (default) | `gpu-l40s-a` / `1gpu-16vcpu-64gb` | `gpu-l40s-a` / `1gpu-8vcpu-32gb` |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` | `gpu-h200-sxm` / `1gpu-16vcpu-200gb` | `gpu-h100-sxm` / `1gpu-16vcpu-200gb` |

Both are `NemotronHForCausalLM` (hybrid Mamba-2 / Transformer). The list lives in
`src/lib/nebius/models.ts`.

## Build with GitHub Actions

`.github/workflows/workers.yml` builds both images on every push that touches `nebius-workers/` (or on demand from the Actions tab) and pushes them to GitHub Container Registry as `ghcr.io/<owner>/forkline-train` and `ghcr.io/<owner>/forkline-serve` (tags `latest` and the commit SHA). Make both packages public so Nebius can pull them without credentials, then set `NEBIUS_TRAIN_IMAGE` / `NEBIUS_SERVE_IMAGE` to those tags. The train image is built without the Mamba-2 kernels by default; run the workflow manually with `mamba_kernels = 1` to include them.

## Build and push

Push both images to a Nebius Container Registry in the same project as the jobs/endpoints
(then no registry credentials are needed). See https://docs.nebius.com/container-registry/quickstart.md.

```bash
export REGION_ID=eu-north1
export REGISTRY_PATH=$(nebius registry create --name forkline --format json | jq -r ".metadata.id" | cut -d- -f 2)
nebius registry configure-helper

cd nebius-workers
docker build -f train/Dockerfile -t cr.$REGION_ID.nebius.cloud/$REGISTRY_PATH/forkline-train:0.1 .
docker build -f serve/Dockerfile -t cr.$REGION_ID.nebius.cloud/$REGISTRY_PATH/forkline-serve:0.1 .
docker push cr.$REGION_ID.nebius.cloud/$REGISTRY_PATH/forkline-train:0.1
docker push cr.$REGION_ID.nebius.cloud/$REGISTRY_PATH/forkline-serve:0.1
```

Set the pushed names as `NEBIUS_TRAIN_IMAGE` and `NEBIUS_SERVE_IMAGE` in the app.

The train image compiles the Mamba-2 kernels (`mamba-ssm`, `causal-conv1d`), which takes a while.
Use `--build-arg MAMBA_KERNELS=0` to skip them; training still works, just slower.

## What the app passes

Non-secret settings go in the container `args` (the job's `args` are readable with `GET`, and the app
reads `--output-uri` back from them). Secrets go in environment variables.

### Environment variables (both images)

| Name | Value |
|---|---|
| `S3_ENDPOINT` | Object Storage endpoint, e.g. `https://storage.eu-north1.nebius.cloud` |
| `S3_REGION` | e.g. `eu-north1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Object Storage access key |
| `HF_TOKEN` | Only if `NEBIUS_HF_TOKEN` is set in the app |

### Train job

Command: `python3 /opt/forkline/train.py`

```
--base-model nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16
--dataset-uri s3://<bucket>/<key>.jsonl
--output-uri s3://<bucket>/<prefix>
--epochs 2 --learning-rate 0.0002 --lora-rank 16 --lora-alpha 32
--target-modules q_proj,k_proj,v_proj,o_proj,up_proj,down_proj
--max-seq-len 2048
```

Dataset format: one JSON object per line, `{"messages": [{"role": "system"|"user"|"assistant", "content": "..."}]}`.
Each conversation is rendered with the model's chat template with `enable_thinking=False`, and the loss
covers the whole rendered text.

Output under `--output-uri`: `adapter_model.safetensors`, `forkline-result.json` (loss, duration) and
`adapter_config.json`, which is uploaded **last**. The app marks the fine-tune as succeeded only when the
job is `COMPLETED` and `adapter_config.json` exists.

### Serve endpoint

Command: `python3 /opt/forkline/serve.py`, container port `8000` (HTTP), auth `token`
(the app generates a random 64-hex token per endpoint and sends it as `Authorization: Bearer ...`).

```
--base-model nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16
--adapter-uri s3://<bucket>/<prefix>
--lora-name adapter --max-lora-rank 64 --max-model-len 16384
--mamba-ssm-cache-dtype float32 --port 8000
```

`serve.py` downloads the adapter to `/models/adapter`, then runs
`vllm serve <base> --enable-lora --lora-modules adapter=/models/adapter --served-model-name base ...`.
Any extra args are passed to vLLM unchanged. Clients call `POST <endpoint URL>/v1/chat/completions` with
`"model": "adapter"`; the app's proxy sets this and adds `stream_options.include_usage` for streams.
`GET /v1/models` lists `adapter` once the model has loaded.

## Try it by hand

```bash
nebius ai job create --name forkline-ft-test \
  --image cr.$REGION_ID.nebius.cloud/$REGISTRY_PATH/forkline-train:0.1 \
  --container-command "python3 /opt/forkline/train.py" \
  --args "--base-model nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16 --dataset-uri s3://<bucket>/train.jsonl --output-uri s3://<bucket>/adapters/test" \
  --env S3_ENDPOINT=https://storage.$REGION_ID.nebius.cloud --env S3_REGION=$REGION_ID \
  --env AWS_ACCESS_KEY_ID=... --env AWS_SECRET_ACCESS_KEY=... \
  --platform gpu-l40s-a --preset 1gpu-16vcpu-64gb --disk-size 200Gi
```

## Unverified points

- The `pytorch/pytorch:2.9.1-cuda12.8-cudnn9-devel` and `vllm/vllm-openai:v0.27.1` tags, and whether
  `mamba-ssm` builds against that PyTorch.
- Which `NemotronH` modules vLLM accepts LoRA weights for. The defaults target attention
  (`q/k/v/o_proj`) and, for the dense 4B model, the MLP (`up/down_proj`); MoE experts and Mamba
  projections are left out.
- Training the 30B MoE model in plain transformers on one H200 has not been measured.
