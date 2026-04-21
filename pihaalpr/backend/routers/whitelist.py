from fastapi import APIRouter, HTTPException
from sqlmodel import select

from backend.database.db import get_session
from backend.models.whitelist import WhitelistEntry, WhitelistEntryCreate, WhitelistEntryRead, WhitelistEntryUpdate
from backend.services import scheduler

router = APIRouter(prefix="/api/whitelist", tags=["whitelist"])


@router.get("", response_model=list[WhitelistEntryRead])
def get_whitelist():
    with get_session() as session:
        return session.exec(select(WhitelistEntry).order_by(WhitelistEntry.plate)).all()


@router.post("", response_model=WhitelistEntryRead, status_code=201)
def create_entry(body: WhitelistEntryCreate):
    entry = WhitelistEntry(**body.model_dump())
    entry.plate = entry.plate.upper().strip()
    with get_session() as session:
        session.add(entry)
        session.commit()
        return entry


@router.put("/{entry_id}", response_model=WhitelistEntryRead)
def update_entry(entry_id: int, body: WhitelistEntryUpdate):
    with get_session() as session:
        entry = session.get(WhitelistEntry, entry_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Nie znaleziono wpisu")
        for field, value in body.model_dump(exclude_unset=True).items():
            if field == "plate" and value is not None:
                value = value.upper().strip()
            setattr(entry, field, value)
        session.add(entry)
        session.commit()
        return entry


@router.post("/{entry_id}/test")
async def test_entry(entry_id: int):
    with get_session() as session:
        entry = session.get(WhitelistEntry, entry_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Nie znaleziono wpisu")
    await scheduler.simulate_detection(entry.plate, "test")
    return {"ok": True, "plate": entry.plate}


@router.delete("/{entry_id}")
def delete_entry(entry_id: int):
    with get_session() as session:
        entry = session.get(WhitelistEntry, entry_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Nie znaleziono wpisu")
        session.delete(entry)
        session.commit()
    return {"ok": True}
