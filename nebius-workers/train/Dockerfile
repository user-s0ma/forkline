# Forkline LoRA fine-tuning image (Nebius Serverless AI Job).
# Build from the nebius-workers directory:
#   docker build -f train/Dockerfile -t cr.<region>.nebius.cloud/<registry>/forkline-train:0.1 .
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-devel

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface \
    HF_HUB_ENABLE_HF_TRANSFER=0

COPY train/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Mamba-2 kernels. The Nemotron-H modeling code published with the models (trust_remote_code) imports
# mamba-ssm unconditionally, so training fails without it. The build fails if they cannot be installed.
# Only compile for the GPUs Forkline trains on (L40S = 8.9, H100/H200 = 9.0) to keep the build short.
ARG MAMBA_KERNELS=1
ENV TORCH_CUDA_ARCH_LIST="8.9;9.0" \
    MAX_JOBS=4
RUN if [ "$MAMBA_KERNELS" = "1" ]; then \
      pip install --no-cache-dir --no-build-isolation causal-conv1d mamba-ssm && \
      python -c "import mamba_ssm, causal_conv1d; print('mamba kernels ok')"; \
    fi

COPY common/s3util.py train/train.py /opt/forkline/

ENTRYPOINT ["python3", "/opt/forkline/train.py"]
