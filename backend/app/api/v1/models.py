
from __future__ import annotations


from fastapi import APIRouter, Depends, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import admin_user, current_user, db_session
from app.core.exceptions import AppError, ErrorCode, NotFoundError
from app.models.model import (
    ModelBenchmark,
    ModelDefinition,
    ModelInstallation,
)
from app.models.user import User
from app.schemas.benchmark import (
    BenchmarkOut,
    BenchmarkRequest,
    BenchmarkSummary,
)
from app.schemas.model import (
    ModelInstallationOut,
    ModelLoadResponse,
    ModelRegisterRequest,
    ModelValidateResponse,
)

from inference.manager.capability_registry import describe_runtime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
MANIFEST_DIR = PROJECT_ROOT / "model_registry" / "manifests"

router = APIRouter()


# --------------------------------------------------
# LIST INSTALLED MODELS
# --------------------------------------------------

@router.get("", response_model=list[ModelInstallationOut])
async def list_models(
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[ModelInstallationOut]:

    result = await session.execute(
        select(ModelInstallation)
        .options(selectinload(ModelInstallation.definition))
        .join(ModelInstallation.definition)
        .order_by(ModelDefinition.parameters_billions)
    )

    rows = result.scalars().all()

    return [
        ModelInstallationOut.model_validate(row).model_copy(update={"generation_contract": describe_runtime(row.runtime)})
        for row in rows
    ]


# --------------------------------------------------
# REGISTER MODEL
# --------------------------------------------------

@router.post(
    "/register",
    response_model=ModelInstallationOut,
    status_code=status.HTTP_201_CREATED,
)
async def register_model(
    payload: ModelRegisterRequest,
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> ModelInstallationOut:

    definition = await session.scalar(
        select(ModelDefinition).where(
            ModelDefinition.slug == payload.definition_slug
        )
    )

    if definition is None:
        raise NotFoundError(
            "ModelDefinition",
            payload.definition_slug,
        )

    existing = await session.scalar(
        select(ModelInstallation).where(
            ModelInstallation.manifest_id == payload.manifest_id
        )
    )

    if existing is not None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"A model installation already exists for manifest "
            f"'{payload.manifest_id}'.",
            status_code=409,
        )

    installation = ModelInstallation(
        definition_id=definition.id,
        manifest_id=payload.manifest_id,
        runtime=payload.runtime,
        quantization=payload.quantization,
        device=payload.device,
        model_path=payload.model_path,
        memory_estimate_mb=payload.memory_estimate_mb,
    )

    session.add(installation)
    await session.commit()

    # Reload installation with its definition relationship.
    result = await session.execute(
        select(ModelInstallation)
        .options(selectinload(ModelInstallation.definition))
        .where(ModelInstallation.id == installation.id)
    )

    installation = result.scalar_one()

    return ModelInstallationOut.model_validate(installation).model_copy(update={"generation_contract": describe_runtime(installation.runtime)})


# --------------------------------------------------
# VALIDATE MODEL
# --------------------------------------------------

@router.post(
    "/{manifest_id}/validate",
    response_model=ModelValidateResponse,
)
async def validate_model(
    manifest_id: str,
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> ModelValidateResponse:

    installation = await session.scalar(
        select(ModelInstallation).where(
            ModelInstallation.manifest_id == manifest_id
        )
    )

    if installation is None:
        raise NotFoundError(
            "ModelInstallation",
            manifest_id,
        )

    errors: list[str] = []

    if not Path(installation.model_path).exists():
        errors.append(
            f"Model path does not exist: {installation.model_path}"
        )

    if not installation.runtime:
        errors.append("Runtime is not set.")

    valid = not errors

    installation.installation_state = (
        "validated" if valid else "invalid"
    )

    await session.commit()

    return ModelValidateResponse(
        manifest_id=manifest_id,
        valid=valid,
        errors=errors,
    )


# --------------------------------------------------
# LOAD MODEL
# --------------------------------------------------

@router.post(
    "/{manifest_id}/load",
    response_model=ModelLoadResponse,
)
async def request_load(
    manifest_id: str,
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> ModelLoadResponse:

    installation = await session.scalar(
        select(ModelInstallation).where(
            ModelInstallation.manifest_id == manifest_id
        )
    )

    if installation is None:
        raise NotFoundError(
            "ModelInstallation",
            manifest_id,
        )

    # The separate inference worker consumes this durable state request.
    # A fresh request can recover a previously interrupted load.
    if installation.loading_state == "loaded" and installation.is_active_model:
        return ModelLoadResponse(manifest_id=manifest_id, state="loaded")

    # Cancel any pending request for another model. The worker serializes actual loads.
    await session.execute(
        update(ModelInstallation)
        .where(ModelInstallation.manifest_id != manifest_id)
        .where(ModelInstallation.loading_state == "loading")
        .values(loading_state="unloaded", is_active_model=False)
    )
    installation.loading_state = "loading"
    installation.last_error = None
    installation.is_active_model = False
    await session.commit()

    return ModelLoadResponse(
        manifest_id=manifest_id,
        state="loading",
    )


# --------------------------------------------------
# UNLOAD MODEL
# --------------------------------------------------

@router.post(
    "/{manifest_id}/unload",
    response_model=ModelLoadResponse,
)
async def request_unload(
    manifest_id: str,
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> ModelLoadResponse:

    installation = await session.scalar(
        select(ModelInstallation).where(
            ModelInstallation.manifest_id == manifest_id
        )
    )

    if installation is None:
        raise NotFoundError(
            "ModelInstallation",
            manifest_id,
        )

    # "unloading" is a command, not a claim that RAM has been freed.
    # The worker acknowledges it only after calling ModelManager.unload().
    if installation.loading_state == "unloaded":
        return ModelLoadResponse(manifest_id=manifest_id, state="unloaded")
    installation.loading_state = "unloading"
    installation.is_active_model = False

    await session.commit()

    return ModelLoadResponse(
        manifest_id=manifest_id,
        state="unloading",
    )


# --------------------------------------------------
# LIST MODEL BENCHMARKS
# --------------------------------------------------

@router.get(
    "/{manifest_id}/benchmarks",
    response_model=list[BenchmarkOut],
)
async def list_benchmarks(
    manifest_id: str,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[BenchmarkOut]:

    installation = await session.scalar(
        select(ModelInstallation)
        .options(selectinload(ModelInstallation.definition))
        .where(ModelInstallation.manifest_id == manifest_id)
    )

    if installation is None:
        raise NotFoundError(
            "ModelInstallation",
            manifest_id,
        )

    definition = installation.definition

    rows = (
        await session.scalars(
            select(ModelBenchmark)
            .where(
                ModelBenchmark.installation_id == installation.id
            )
            .order_by(ModelBenchmark.created_at.desc())
            .limit(200)
        )
    ).all()

    display_name = (
        definition.display_name
        if definition
        else installation.manifest_id
    )

    return [
        BenchmarkOut(
            id=row.id,
            installation_id=row.installation_id,
            manifest_id=installation.manifest_id,
            display_name=display_name,
            sample_name=row.sample_name,
            text_length_chars=row.text_length_chars,
            generation_time_seconds=row.generation_time_seconds,
            audio_duration_seconds=row.audio_duration_seconds,
            real_time_factor=row.real_time_factor,
            time_to_first_audio_seconds=row.time_to_first_audio_seconds,
            peak_ram_mb=row.peak_ram_mb,
            cpu_percent=row.cpu_percent,
            sample_rate=row.sample_rate,
            output_size_bytes=row.output_size_bytes,
            cold_start=row.cold_start,
            success=row.success,
            error_message=row.error_message,
            created_at=row.created_at,
        )
        for row in rows
    ]


# --------------------------------------------------
# BENCHMARK SUMMARY
# --------------------------------------------------

@router.get(
    "/benchmarks/summary",
    response_model=list[BenchmarkSummary],
)
async def benchmark_summary(
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> list[BenchmarkSummary]:

    installations = (
        await session.scalars(
            select(ModelInstallation)
            .options(selectinload(ModelInstallation.definition))
            .join(ModelInstallation.definition)
        )
    ).all()

    summaries: list[BenchmarkSummary] = []

    for installation in installations:

        definition = installation.definition

        rows = (
            await session.scalars(
                select(ModelBenchmark)
                .where(
                    ModelBenchmark.installation_id == installation.id
                )
                .where(ModelBenchmark.success.is_(True))
                .where(ModelBenchmark.cold_start.is_(False))
            )
        ).all()

        display_name = (
            definition.display_name
            if definition
            else installation.manifest_id
        )

        if not rows:
            summaries.append(
                BenchmarkSummary(
                    manifest_id=installation.manifest_id,
                    display_name=display_name,
                    runs=0,
                    best_rtf=None,
                    worst_rtf=None,
                    peak_ram_mb=None,
                    last_run_at=None,
                )
            )
            continue

        rtfs = [
            row.real_time_factor
            for row in rows
        ]

        rss = [
            row.peak_ram_mb
            for row in rows
            if row.peak_ram_mb is not None
        ]

        last = max(
            row.created_at
            for row in rows
        )

        summaries.append(
            BenchmarkSummary(
                manifest_id=installation.manifest_id,
                display_name=display_name,
                runs=len(rows),
                best_rtf=min(rtfs),
                worst_rtf=max(rtfs),
                peak_ram_mb=max(rss) if rss else None,
                last_run_at=last,
            )
        )

    return summaries


# --------------------------------------------------
# RUN MODEL BENCHMARK
# --------------------------------------------------

@router.post(
    "/benchmark",
    response_model=list[BenchmarkOut],
)
async def run_benchmark(
    payload: BenchmarkRequest,
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(db_session),
) -> list[BenchmarkOut]:

    installation = await session.scalar(
        select(ModelInstallation)
        .options(selectinload(ModelInstallation.definition))
        .where(
            ModelInstallation.manifest_id == payload.manifest_id
        )
    )

    if installation is None:
        raise NotFoundError(
            "ModelInstallation",
            payload.manifest_id,
        )

    definition = installation.definition

    # Import inference components only when needed.
    from inference.benchmarks.runner import (
        DEFAULT_SAMPLES,
        run_benchmarks,
    )


    from inference.benchmarks.runner import (
        DEFAULT_SAMPLES,
        run_benchmarks,
    )
    from inference.manager.loader import ModelManager
    from inference.manager.registry import ManifestRegistry

    registry = ManifestRegistry(MANIFEST_DIR)
    registry.scan()

    if registry.get(payload.manifest_id) is None:
        raise AppError(
            ErrorCode.MODEL_NOT_INSTALLED,
            (
                f"No manifest file found for '{payload.manifest_id}'. "
                "The benchmark runner reads from "
                "model_registry/manifests/."
            ),
            status_code=422,
        )

    samples = {
        key: value
        for key, value in DEFAULT_SAMPLES.items()
        if key in payload.samples
    } or DEFAULT_SAMPLES

    manager = ModelManager(registry)

    await manager.start()

    try:
        results = await run_benchmarks(
            manager,
            payload.manifest_id,
            samples=samples,
            include_cold_start=payload.include_cold_start,
        )
    finally:
        await manager.stop()

    # Persist benchmark results.
    benchmark_rows: list[ModelBenchmark] = []

    for result in results:

        if result.sample_name == "cold_start_load":
            sample_name = "cold_start_load"
            text_length = 0
        else:
            sample_name = result.sample_name
            text_length = result.text_length_chars

        row = ModelBenchmark(
            installation_id=installation.id,
            sample_name=sample_name,
            text_length_chars=text_length,
            generation_time_seconds=result.generation_time_seconds,
            audio_duration_seconds=result.audio_duration_seconds,
            real_time_factor=result.real_time_factor,
            peak_ram_mb=result.peak_ram_mb,
            cpu_percent=result.cpu_percent,
            sample_rate=result.sample_rate,
            output_size_bytes=result.output_size_bytes,
            cold_start=result.cold_start,
            success=result.success,
            error_message=result.error_message,
        )

        session.add(row)
        benchmark_rows.append(row)

    await session.flush()

    # Ensure database-generated fields are available.
    for row in benchmark_rows:
        await session.refresh(row)

    await session.commit()

    display_name = (
        definition.display_name
        if definition
        else installation.manifest_id
    )

    return [
        BenchmarkOut(
            id=row.id,
            installation_id=row.installation_id,
            manifest_id=installation.manifest_id,
            display_name=display_name,
            sample_name=row.sample_name,
            text_length_chars=row.text_length_chars,
            generation_time_seconds=row.generation_time_seconds,
            audio_duration_seconds=row.audio_duration_seconds,
            real_time_factor=row.real_time_factor,
            time_to_first_audio_seconds=row.time_to_first_audio_seconds,
            peak_ram_mb=row.peak_ram_mb,
            cpu_percent=row.cpu_percent,
            sample_rate=row.sample_rate,
            output_size_bytes=row.output_size_bytes,
            cold_start=row.cold_start,
            success=row.success,
            error_message=row.error_message,
            created_at=row.created_at,
        )
        for row in benchmark_rows
    ]
