import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from backend.services import mqtt as mqtt_svc

router = APIRouter(prefix="/api/mqtt", tags=["mqtt"])


@router.get("/log")
def get_log():
    return mqtt_svc.get_log()


@router.get("/events")
async def mqtt_events():
    async def generator():
        queue = mqtt_svc.subscribe()
        try:
            # send buffered history first
            for event in mqtt_svc.get_log():
                yield f"data: {json.dumps(event)}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            mqtt_svc.unsubscribe(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
