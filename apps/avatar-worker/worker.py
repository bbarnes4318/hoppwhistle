"""Industry Research avatar briefing worker.

A LiveKit Agents worker: when a room is created with an agent dispatch carrying
the briefing text + avatar id (metadata), it joins the room, attaches the
Protoface avatar, and speaks the briefing with a free local Piper voice. The
browser joins the same room (viewer token minted by the API) and sees the avatar.

Run: `python worker.py start`  (registers with LiveKit using LIVEKIT_* env).
"""
from __future__ import annotations

import json
import logging

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import protoface

from piper_tts import PiperTTS

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ir-avatar")

DEFAULT_AVATAR = "av_stock_280"


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    meta = {}
    try:
        meta = json.loads(ctx.job.metadata or "{}")
    except Exception:
        pass
    text = (meta.get("text") or "").strip() or "No briefing text was provided for this report."
    avatar_id = meta.get("avatarId") or DEFAULT_AVATAR
    log.info("avatar job: room=%s avatar=%s chars=%d", ctx.room.name, avatar_id, len(text))

    session = AgentSession(tts=PiperTTS())
    avatar = protoface.AvatarSession(avatar_id=avatar_id)

    # Attach the avatar to the room BEFORE starting the session so the avatar
    # renders the session's audio as a lip-synced video participant.
    await avatar.start(session, room=ctx.room)
    await session.start(agent=Agent(instructions=""), room=ctx.room)

    # Speak the fixed briefing, then let the avatar idle out.
    await session.say(text, allow_interruptions=False)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="ir-avatar",
        )
    )
