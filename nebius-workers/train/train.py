"""Forkline LoRA fine-tuning job for Nemotron (runs as a Nebius Serverless AI Job).

1. Downloads the chat JSONL dataset from Object Storage.
2. Fine-tunes a LoRA adapter on the base model with PEFT + TRL (bf16, one GPU).
3. Uploads the adapter to Object Storage under --output-uri. adapter_config.json is
   uploaded last; the app treats its presence as "training finished".

Non-secret settings come from the command-line args (the app passes them via the job's
`args`); S3 credentials and HF_TOKEN come from environment variables.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

WORK = pathlib.Path("/tmp/forkline")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--base-model", required=True)
    p.add_argument("--dataset-uri", required=True)
    p.add_argument("--output-uri", required=True)
    p.add_argument("--epochs", type=int, default=2)
    p.add_argument("--learning-rate", type=float, default=2e-4)
    p.add_argument("--lora-rank", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--lora-dropout", type=float, default=0.05)
    p.add_argument("--target-modules", default="q_proj,k_proj,v_proj,o_proj")
    p.add_argument("--max-seq-len", type=int, default=2048)
    p.add_argument("--batch-size", type=int, default=1)
    p.add_argument("--grad-accum", type=int, default=8)
    return p.parse_args()


def render_conversations(tokenizer, rows: list[dict]) -> list[str]:
    """Render each conversation with the model's chat template, reasoning turned off.

    The serving side sends chat_template_kwargs={"enable_thinking": false} by default,
    so training and inference see the same prompt format.
    """
    texts = []
    for row in rows:
        messages = [{"role": m["role"], "content": m["content"]} for m in row["messages"]]
        try:
            text = tokenizer.apply_chat_template(messages, tokenize=False, enable_thinking=False)
        except TypeError:
            text = tokenizer.apply_chat_template(messages, tokenize=False)
        texts.append(text)
    return texts


def main() -> int:
    args = parse_args()
    started = time.time()

    # Heavy imports after arg parsing so `--help` stays fast.
    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    from s3util import download_file, upload_dir

    data_path = WORK / "train.jsonl"
    out_dir = WORK / "adapter"
    print(f"[forkline] downloading dataset {args.dataset_uri}", flush=True)
    download_file(args.dataset_uri, data_path)
    rows = [json.loads(line) for line in data_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        print("[forkline] dataset is empty", file=sys.stderr)
        return 2
    print(f"[forkline] {len(rows)} conversations", flush=True)

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    dataset = Dataset.from_dict({"text": render_conversations(tokenizer, rows)})

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
        device_map={"": 0},
    )
    model.config.use_cache = False

    lora = LoraConfig(
        r=args.lora_rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=[m for m in args.target_modules.split(",") if m],
        bias="none",
        task_type="CAUSAL_LM",
    )
    config = SFTConfig(
        output_dir=str(WORK / "run"),
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=10,
        save_strategy="no",
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        max_length=args.max_seq_len,
        dataset_text_field="text",
        packing=False,
        report_to="none",
    )
    trainer = SFTTrainer(
        model=model,
        args=config,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=lora,
    )
    result = trainer.train()

    out_dir.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(out_dir))
    (out_dir / "forkline-result.json").write_text(
        json.dumps(
            {
                "base_model": args.base_model,
                "conversations": len(rows),
                "epochs": args.epochs,
                "train_loss": result.training_loss,
                "seconds": round(time.time() - started),
            }
        ),
        encoding="utf-8",
    )
    print(f"[forkline] uploading adapter to {args.output_uri}", flush=True)
    upload_dir(out_dir, args.output_uri, last="adapter_config.json")
    print("[forkline] done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
