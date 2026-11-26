# Phase 11.4
Apply after 11.3 with services stopped. No migrations or new dependencies.
Open /queue for owner-scoped recent jobs. Cancel queued extraction/ASR only; running jobs finish. Retry ASR if source remains; extraction retry via Voice Cloning. TTS controls remain in Generation History. Failed/cancelled uploads are retained for retry. No automatic retention deletion. Scheduler gives TTS a chance after each local job; not strict global FIFO.

Offline storage audit (stop all services, back up database and storage):
`python scripts/storage_maintenance.py --services-stopped --days 7`
Add `--quarantine` only after reviewing output. Moves old unregistered audio under generated directory to storage/quarantine/<uuid>, retaining relative paths. Restore manually to generated directory. No permanent deletion; no automatic cleanup of private voices, reference audio, failed uploads, models or exports. Database paths must be valid on this machine. API shutdown is operator-confirmed, not detected. Quarantine is not transactional; a partial move can occur if interrupted. Do not run with custom scripts writing storage. Missing registered files are reported only.

Test: `python backend/tests/test_queue_controls.py` with PYTHONPATH backend and root. Verify queued cancellation while worker is busy, retry with retained upload, cross-account access denied, TTS interleaving, and audit before quarantine. Windows, DB and full frontend typecheck require local validation.
