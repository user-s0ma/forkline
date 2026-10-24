# Forkline LoRA fine-tuning image (Nebius Serverless AI Job).
# Build from the nebius-workers directory:
#   docker build -f train/Dockerfile -t cr.<region>.nebius.cloud/<registry>/forkline-train:0.1 .
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-devel

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface \
    HF_HUB_ENABLE_HF_TRANSFER=0

COPY train/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Fast Mamba-2 kernels. Without them transformers falls back to a slower pure-PyTorch path.
# Building them takes a while; pass --build-arg MAMBA_KERNELS=0 to skip.
ARG MAMBA_KERNELS=1
RUN if [ "$MAMBA_KERNELS" = "1" ]; then \
      pip install --no-cache-dir --no-build-isolation causal-conv1d mamba-ssm || \
      echo "mamba kernels not installed; training will use the slow path"; \
    fi

COPY common/s3util.py train/train.py /opt/forkline/

ENTRYPOINT ["python3", "/opt/forkline/train.py"]
