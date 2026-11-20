# Short Titles

Names bb threads in one or two words («Красный CI», «Onboarding v3») instead
of a sentence, so the sidebar stays scannable.

It is an AI service for bb's thread-title task backed by any
OpenAI-compatible chat endpoint; the default is a local Ollama
(`http://127.0.0.1:11434/v1`, model `qwen3.5:4b`).

```bash
bb plugin install ./short-titles --yes
bb settings ai-services set thread-title short --plugin short-titles
```

Settings and behavior: [`skills/short-titles/SKILL.md`](skills/short-titles/SKILL.md).
