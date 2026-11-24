
from __future__ import annotations

import uuid

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
