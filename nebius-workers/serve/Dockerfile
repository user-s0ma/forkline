# Forkline serving image: vLLM (OpenAI-compatible) + one LoRA adapter from Object Storage.
# Build from the nebius-workers directory:
#   docker build -f serve/Dockerfile -t cr.<region>.nebius.cloud/<registry>/forkline-serve:0.1 .
# v0.27.1 is the version the Nemotron 3.5 Lightning model card uses; Nemotron 3 Nano 4B needs >= 0.15.1.
FROM vllm/vllm-openai:v0.27.1

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface

RUN pip install --no-cache-dir "boto3>=1.40.0"

COPY common/s3util.py serve/serve.py /opt/forkline/

EXPOSE 8000
ENTRYPOINT ["python3", "/opt/forkline/serve.py"]
