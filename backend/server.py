import asyncio
import json
import re
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

LLM_BASE_URL = "http://localhost:8088"
LLM_MODEL = "qwen3"
LLM_TIMEOUT = 30

client: httpx.AsyncClient = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    client = httpx.AsyncClient(timeout=LLM_TIMEOUT)
    yield
    await client.aclose()


app = FastAPI(title="AI Answer Assistant Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QuestionItem(BaseModel):
    id: str
    type: str  # multiple_choice, checkbox, text, select
    text: str
    options: Optional[list[str]] = None


class AnswerRequest(BaseModel):
    questions: list[QuestionItem]


class AnswerItem(BaseModel):
    id: str
    answer: str  # the option letter(s) for choice, text for text input


class AnswerResponse(BaseModel):
    answers: list[AnswerItem]


def build_prompt(questions: list[QuestionItem]) -> str:
    lines = [
        "You are answering quiz questions. Answer each question concisely.",
        "For multiple choice / checkbox / select questions, reply with ONLY the letter(s) of the correct option(s).",
        "For text questions, reply with the exact short answer (a word, number, or short phrase).",
        "Respond in strict JSON format with an array of objects: [{\"id\": \"...\", \"answer\": \"...\"}]",
        "",
    ]

    for i, q in enumerate(questions):
        lines.append(f"Question ID: {q.id} (type: {q.type})")
        lines.append(q.text)
        if q.options:
            for j, opt in enumerate(q.options):
                letter = chr(ord("A") + j)
                lines.append(f"  {letter}) {opt}")
        lines.append("")

    return "\n".join(lines)


def parse_response(raw: str, questions: list[QuestionItem]) -> list[AnswerItem]:
    json_match = re.search(r"\[.*\]", raw, re.DOTALL)
    if json_match:
        try:
            parsed = json.loads(json_match.group())
            return [AnswerItem(id=item["id"], answer=str(item["answer"])) for item in parsed]
        except (json.JSONDecodeError, KeyError):
            pass

    retranswers: list[AnswerItem] = []
    pattern = re.compile(
        r"(?:Question\s+ID:\s*(\S+)|Answer\s*(?:for\s*)?(\S+)?\s*:?\s*(.+?))(?=\n(?:Question|Answer|$)|\Z)",
        re.IGNORECASE,
    )
    matches = pattern.findall(raw)
    for m in matches:
        qid = m[0] or m[1] or "unknown"
        ans = m[2].strip() if m[2] else ""
        answers.append(AnswerItem(id=qid, answer=ans))

    if answers:
        return answers

    return [AnswerItem(id=q.id, answer="") for q in questions]


async def call_ollama(prompt: str) -> str:
    payload = {
        "model": LLM_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    resp = await client.post(f"{LLM_BASE_URL}/api/generate", json=payload)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "")


async def call_openai_compatible(prompt: str) -> str:
    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
    }
    resp = await client.post(f"{LLM_BASE_URL}/v1/chat/completions", json=payload)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/answer", response_model=AnswerResponse)
async def answer_questions(req: AnswerRequest):
    if not req.questions:
        return AnswerResponse(answers=[])

    prompt = build_prompt(req.questions)

    raw = ""
    try:
        raw = await call_openai_compatible(prompt)
    except Exception:
        try:
            raw = await call_ollama(prompt)
        except Exception as e:
            return AnswerResponse(
                answers=[AnswerItem(id=q.id, answer=f"Error: {e}") for q in req.questions]
            )

    answers = parse_response(raw, req.questions)
    return AnswerResponse(answers=answers)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
