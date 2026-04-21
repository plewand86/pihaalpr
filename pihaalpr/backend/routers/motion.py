import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import Response, StreamingResponse

from backend.services import motion as motion_svc

router = APIRouter(prefix="/api/motion", tags=["motion"])


@router.get("/events")
async def motion_events():
    async def generator():
        queue = motion_svc.subscribe()
        # send current state immediately
        for state in motion_svc.get_all_state().values():
            yield f"data: {json.dumps(state)}\n\n"
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            motion_svc.unsubscribe(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/frame/{camera_id}")
async def motion_frame(camera_id: int):
    image = motion_svc.get_latest_preview(camera_id)
    if not image:
        return Response(status_code=404)
    return Response(
        content=image,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/stream/{camera_id}")
async def motion_stream(camera_id: int):
    async def generator():
        last_ts = None
        while True:
            image = motion_svc.get_latest_preview(camera_id)
            ts = motion_svc.get_latest_preview_ts(camera_id)
            if image and ts and ts != last_ts:
                last_ts = ts
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + image + b"\r\n"
                )
            else:
                await asyncio.sleep(0.1)

    return StreamingResponse(
        generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "X-Accel-Buffering": "no"},
    )
