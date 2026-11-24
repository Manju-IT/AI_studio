# Architecture

## Overview

AI Voice Studio is a **modular monolith** with one separate inference worker.
There is no microservice split, no message broker, no cache layer. PostgreSQL
is both the source of truth and the job queue.
