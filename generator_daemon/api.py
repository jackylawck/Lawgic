# generator_daemon/api.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ai_forge_bridge import AIForgeBridge

app = FastAPI(title="LogiCore AI Forge API", version="1.0.0")

# 允許前端 Cross-Origin 跨域呼叫
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ForgeRequest(BaseModel):
    prompt: str

@app.post("/api/forge")
async def forge_puzzle(request: ForgeRequest):
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")
    try:
        puzzle = AIForgeBridge.forge_puzzle(request.prompt)
        return puzzle
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forge synthesis error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
