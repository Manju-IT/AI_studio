# Model Setup

This project ships with three built-in model families. Each has different
installation requirements. None of them download weights automatically
without your knowledge.

## 1. Seed the model definitions

```powershell
# From repository root, with the venv active and the database reachable
python scripts/seed_models.py