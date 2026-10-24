const API_BASE = "https://forkline.ai/v1";

export function apiSnippets(slug: string) {
  return {
    curl: `curl ${API_BASE}/chat/completions \
  -H "Authorization: Bearer $FORKLINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "${slug}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
    python: `import os

from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE}",
    api_key=os.environ["FORKLINE_API_KEY"],
)

response = client.chat.completions.create(
    model="${slug}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`,
  };
}
