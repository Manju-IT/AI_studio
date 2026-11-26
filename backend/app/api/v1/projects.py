
from __future__ import annotations

import uuid
from inference.voice_assets import usable

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_user, db_session
from app.core.exceptions import ForbiddenError, NotFoundError
from app.models.project import Project, ProjectFolder
from app.models.user import User, Workspace
from app.schemas.project import (
    FolderCreateRequest,
    ProjectCreateRequest,
    ProjectOut,
    ProjectUpdateRequest,
)

router = APIRouter()


def project_query():
    """
    Return a Project query with relationships required
    by ProjectOut eagerly loaded.
    """
    return select(Project).options(
        selectinload(Project.folders)
    )


async def get_project_or_404(
    session: AsyncSession,
    project_id: uuid.UUID,
    user: User,
) -> Project:
    """
    Retrieve a project and verify access.

    Project owners and administrators can access it.
    """
    project = await session.scalar(
        project_query().where(Project.id == project_id)
    )

    if project is None:
        raise NotFoundError("Project", str(project_id))

    if project.owner_id != user.id and user.role != "admin":
        raise ForbiddenError("You do not own this project.")

    return project


async def serialize_project(
    session: AsyncSession,
    project: Project,
) -> ProjectOut:
    """
    Explicitly refresh project attributes and folders
    before Pydantic response serialization.

    This avoids implicit async relationship loading.
    """
    await session.refresh(
        project,
        attribute_names=[
            "name",
            "description",
            "is_archived",
            "created_at",
            "folders",
        ],
    )

    return ProjectOut.model_validate(project)


# ---------------------------------------------------------
# LIST PROJECTS
# ---------------------------------------------------------

@router.get(
    "",
    response_model=list[ProjectOut],
)
async def list_projects(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[ProjectOut]:

    result = await session.scalars(
        project_query()
        .where(Project.owner_id == user.id)
        .order_by(Project.created_at.desc())
    )

    projects = result.all()

    return [
        ProjectOut.model_validate(project)
        for project in projects
    ]


# ---------------------------------------------------------
# CREATE PROJECT
# ---------------------------------------------------------

@router.post(
    "",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    payload: ProjectCreateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> ProjectOut:

    workspace = await session.scalar(
        select(Workspace).limit(1)
    )

    if workspace is None:
        raise NotFoundError("Workspace", "default")

    project = Project(
        workspace_id=workspace.id,
        owner_id=user.id,
        name=payload.name,
        description=payload.description,
    )

    session.add(project)

    await session.commit()

    return await serialize_project(session, project)


# ---------------------------------------------------------
# GET PROJECT DETAILS
# ---------------------------------------------------------

@router.get(
    "/{project_id}",
    response_model=ProjectOut,
)
async def get_project(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> ProjectOut:

    project = await get_project_or_404(
        session=session,
        project_id=project_id,
        user=user,
    )

    return ProjectOut.model_validate(project)


# ---------------------------------------------------------
# UPDATE PROJECT
# ---------------------------------------------------------

@router.patch(
    "/{project_id}",
    response_model=ProjectOut,
)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> ProjectOut:

    project = await get_project_or_404(
        session=session,
        project_id=project_id,
        user=user,
    )

    changes = payload.model_dump(exclude_unset=True)

    for field, value in changes.items():
        setattr(project, field, value)

    await session.commit()

    return await serialize_project(session, project)


# ---------------------------------------------------------
# DELETE PROJECT
# ---------------------------------------------------------

@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_project(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> None:

    project = await get_project_or_404(
        session=session,
        project_id=project_id,
        user=user,
    )

    await session.delete(project)
    await session.commit()


# ---------------------------------------------------------
# CREATE PROJECT FOLDER
# ---------------------------------------------------------

@router.post(
    "/{project_id}/folders",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    project_id: uuid.UUID,
    payload: FolderCreateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> ProjectOut:

    project = await get_project_or_404(
        session=session,
        project_id=project_id,
        user=user,
    )

    # Validate the parent folder if one is specified.
    if payload.parent_id is not None:

        parent = await session.scalar(
            select(ProjectFolder).where(
                ProjectFolder.id == payload.parent_id,
                ProjectFolder.project_id == project.id,
            )
        )

        if parent is None:
            raise NotFoundError(
                "ProjectFolder",
                str(payload.parent_id),
            )

    folder = ProjectFolder(
        project_id=project.id,
        parent_id=payload.parent_id,
        name=payload.name,
    )

    session.add(folder)

    await session.commit()

    return await serialize_project(session, project)


# Project editor: the project row is the transaction boundary for script changes.
from pathlib import Path
import asyncio
from sqlalchemy import update
from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode
from app.models.job import GenerationJob
from app.models.audio import AudioAsset
from app.models.model import ModelInstallation
from app.models.voice import Voice
from app.schemas.project import ScriptSave, ScriptOut, ScriptSegment, DubbingCreate
from app.schemas.audio import AudioAssetOut
from app.schemas.job import GenerationJobOut
from app.services.audio.assets import create_audio_asset
from app.services.audio.project_mix import render_project, render_aligned
from inference.manager.capability_registry import validate_settings


def invalid(message, code=422):
    return AppError(ErrorCode.VALIDATION_ERROR, message, status_code=code)

async def locked_project(session, project_id, user):
    project = await session.scalar(select(Project).where(Project.id == project_id).with_for_update())
    if project is None:
        raise NotFoundError("Project", str(project_id))
    if project.owner_id != user.id:
        raise ForbiddenError("Only the project owner can edit or export its script.")
    if project.is_archived:
        raise invalid("Restore this archived project before editing.", 409)
    return project


def script_out(project):
    return ScriptOut(revision=project.script_revision, segments=project.script_segments)


def matches(segment, job):
    return (segment.text == job.text and segment.model_installation_id == job.model_installation_id
            and segment.voice_id == job.voice_id and segment.language == job.language)

@router.get("/{project_id}/script", response_model=ScriptOut)
async def get_script(project_id: uuid.UUID, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    project = await get_project_or_404(session, project_id, user)
    if project.owner_id != user.id:
        raise ForbiddenError()
    return script_out(project)

@router.put("/{project_id}/script", response_model=ScriptOut)
async def save_script(project_id: uuid.UUID, payload: ScriptSave, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    project = await locked_project(session, project_id, user)
    if payload.revision != project.script_revision:
        raise invalid("Script changed in another tab. Reload before saving.", 409)
    if len({s.id for s in payload.segments}) != len(payload.segments):
        raise invalid("Duplicate segment IDs.")
    old = {s.id: s for s in map(ScriptSegment.model_validate, project.script_segments)}
    for s in payload.segments:
        previous = old.get(s.id)
        # Clients cannot attach arbitrary jobs; preserve only unchanged server-issued links.
        s.job_id = previous.job_id if previous and (s.text, s.model_installation_id, s.voice_id, s.language) == (previous.text, previous.model_installation_id, previous.voice_id, previous.language) else None
    project.script_segments = [s.model_dump(mode="json") for s in payload.segments]
    project.script_revision += 1
    await session.commit()
    return script_out(project)

async def queue_segment(session, project, user, segment):
    if not segment.text.strip() or not segment.model_installation_id:
        raise invalid("Enter text and select a model.")
    if segment.job_id:
        previous = await session.get(GenerationJob, segment.job_id)
        if previous and previous.status not in {"completed", "failed", "cancelled"}:
            raise invalid("This segment already has an active generation.", 409)
    model = await session.get(ModelInstallation, segment.model_installation_id)
    if model is None or model.installation_state == "invalid":
        raise invalid("Model unavailable.")
    await session.refresh(model, attribute_names=["definition"])
    if segment.language not in model.definition.languages:
        raise invalid("Unsupported language.")
    try:
        settings = validate_settings(model.runtime, {})
    except ValueError as exc:
        raise invalid(str(exc)) from exc
    if segment.voice_id:
        voice = await session.get(Voice, segment.voice_id)
        if not voice or not usable(voice, user.id, model) or not voice.is_active or voice.owner_id not in (None, user.id) or voice.workspace_id != project.workspace_id or voice.model_installation_id != model.id or voice.language.lower() != segment.language.lower() or model.runtime == "piper":
            raise invalid("Incompatible voice.")
    job = GenerationJob(workspace_id=project.workspace_id, created_by_user_id=user.id, project_id=project.id, model_installation_id=model.id, voice_id=segment.voice_id, text=segment.text, language=segment.language, settings=settings, status="queued", is_long_form=len(segment.text)>600, progress_current=0, progress_total=0 if len(segment.text)>600 else 1)
    session.add(job)
    await session.flush()
    segment.job_id = job.id

@router.post("/{project_id}/script/{segment_id}/generate", response_model=ScriptOut)
async def generate_segment(project_id: uuid.UUID, segment_id: uuid.UUID, revision: int, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    project = await locked_project(session, project_id, user)
    if revision != project.script_revision:
        raise invalid("Script changed. Reload before generating.", 409)
    segments = [ScriptSegment.model_validate(s) for s in project.script_segments]
    segment = next((s for s in segments if s.id == segment_id), None)
    if segment is None:
        raise NotFoundError("Segment", str(segment_id))
    await queue_segment(session, project, user, segment)
    project.script_segments = [s.model_dump(mode="json") for s in segments]
    project.script_revision += 1
    await session.commit()
    return script_out(project)

@router.post("/{project_id}/script/batch", response_model=ScriptOut)
async def generate_batch(project_id: uuid.UUID, revision: int, retry_only: bool = False, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    project = await locked_project(session, project_id, user)
    if revision != project.script_revision:
        raise invalid("Script changed. Reload before generating.", 409)
    segments = [ScriptSegment.model_validate(s) for s in project.script_segments]
    selected = []
    for segment in segments:
        job = await session.get(GenerationJob, segment.job_id) if segment.job_id else None
        if job and (job.project_id != project.id or job.created_by_user_id != user.id or not matches(segment, job)):
            raise invalid("Invalid segment job link.")
        if retry_only:
            if job and job.status in {"failed", "cancelled"}:
                selected.append(segment)
        elif not job or job.status in {"failed", "cancelled"}:
            selected.append(segment)
    if not selected:
        raise invalid("No eligible segments to queue.", 409)
    try:
        for segment in selected:
            await queue_segment(session, project, user, segment)
        project.script_segments = [s.model_dump(mode="json") for s in segments]
        project.script_revision += 1
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return script_out(project)

@router.post("/{project_id}/script/export", response_model=AudioAssetOut)
async def export_script(project_id: uuid.UUID, revision: int, aligned: bool = False, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    project = await locked_project(session, project_id, user)
    if revision != project.script_revision:
        raise invalid("Save the current script before exporting.", 409)
    sources = []
    for raw in project.script_segments:
        segment = ScriptSegment.model_validate(raw)
        job = await session.get(GenerationJob, segment.job_id) if segment.job_id else None
        if not job or job.project_id != project.id or job.created_by_user_id != user.id or job.status != "completed" or not matches(segment, job) or not job.audio_asset_id:
            raise invalid("Generate every current segment before exporting.")
        asset = await session.get(AudioAsset, job.audio_asset_id)
        if not asset or asset.owner_id != user.id or asset.project_id != project.id or not Path(asset.storage_path).is_file():
            raise invalid("A segment audio file is missing or inaccessible.")
        if aligned:
            if segment.source_start is None or segment.source_end is None or segment.source_end <= segment.source_start:
                raise invalid("Aligned export requires valid source timestamps for every segment.")
            sources.append((Path(asset.storage_path), segment.source_start, segment.source_end))
        else:
            sources.append((Path(asset.storage_path), segment.pause_ms))
    if not sources:
        raise invalid("Add at least one segment.")
    output = get_settings().generated_audio_dir / f"project_{uuid.uuid4().hex}.wav"
    try:
        await asyncio.to_thread(render_aligned if aligned else render_project, sources, output)
        asset = await create_audio_asset(session, workspace_id=project.workspace_id, owner_id=user.id, project_id=project.id, source_path=output, title=project.name)
        await session.commit()
    except ValueError as exc:
        output.unlink(missing_ok=True)
        raise invalid(str(exc)) from exc
    except Exception:
        output.unlink(missing_ok=True)
        raise
    return AudioAssetOut.model_validate(asset)


def normalize_transcript_interval(row, index):
    """Repair small alignment artifacts without inventing missing timestamps."""
    import math
    try:
        start, end = float(row["start"]), float(row["end"])
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"Segment {index}: missing or nonnumeric timestamps.") from exc
    if not (math.isfinite(start) and math.isfinite(end)):
        raise ValueError(f"Segment {index}: nonfinite timestamps.")
    tolerance = 0.05
    if min(start, end) < -tolerance or max(start, end) > 1800 + tolerance or start - end > tolerance:
        raise ValueError(f"Segment {index}: invalid timestamps (start={start}, end={end}).")
    start = min(1800.0, max(0.0, start))
    end = min(1800.0, max(0.0, end))
    if end <= start:
        if start >= 1800.0:
            start = 1799.98
            end = 1800.0
        else:
            end = min(1800.0, start + 0.02)
    return start, end


@router.post("/dubbing/import", response_model=ProjectOut, status_code=201)
async def import_dubbing(payload: DubbingCreate, user: User = Depends(current_user), session: AsyncSession = Depends(db_session)):
    from app.api.v1.transcriptions import read
    _, transcript = read(user.id, payload.transcription_id)
    if transcript.get("status") != "completed":
        raise invalid("Select a completed transcription.")
    rows = [r for r in transcript.get("segments", []) if r.get("text", "").strip()]
    if not 1 <= len(rows) <= 100:
        raise invalid("Dubbing requires 1–100 nonempty transcript segments.")
    segments = []
    for index, row in enumerate(rows, start=1):
        try:
            start, end = normalize_transcript_interval(row, index)
        except ValueError as exc:
            raise invalid(str(exc)) from exc
        text = row["text"]
        segments.append(ScriptSegment(id=uuid.uuid4(), speaker=row.get("speaker") or "Speaker 1", source_text=text, source_start=start, source_end=end, text=text if transcript.get("language") == payload.language else "", language=payload.language, pause_ms=0).model_dump(mode="json"))
    segments.sort(key=lambda r: r["source_start"])
    workspace = await session.scalar(select(Workspace).limit(1))
    if workspace is None:
        raise NotFoundError("Workspace", "default")
    project = Project(workspace_id=workspace.id, owner_id=user.id, name=payload.name, description=f"Dubbing from transcription {payload.transcription_id}", script_segments=segments, script_revision=0)
    session.add(project)
    await session.commit()
    return await serialize_project(session, project)
