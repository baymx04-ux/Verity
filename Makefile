SHELL := /bin/bash
COMPOSE ?= docker compose
ENV_FILE ?= .env
PYTHON ?= $(shell command -v python3.11 >/dev/null 2>&1 && echo python3.11 || echo python3)
VENV := services/ai/.venv
AI_PYTHON := $(VENV)/bin/python

.DEFAULT_GOAL := help

.PHONY: help env install up infra down clean ps logs build migrate seed \
	test test-node test-ai lint typecheck format format-check check verify-roles audit

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if it does not exist
	@if [ ! -f "$(ENV_FILE)" ]; then \
		cp .env.example "$(ENV_FILE)"; \
		echo "Created $(ENV_FILE) from .env.example. Review it before exposing this stack."; \
	fi

install: ## Install local Node and Python development dependencies
	npm install
	$(PYTHON) -m venv $(VENV)
	$(AI_PYTHON) -m pip install --upgrade pip
	$(AI_PYTHON) -m pip install -r services/ai/requirements.txt -r services/ai/requirements-dev.txt

up: env ## Build and start the full stack
	$(COMPOSE) up -d --build
	@echo "Verity is starting: web http://localhost:5173 · api http://localhost:4000/api/health"

infra: env ## Start only Postgres, Redis and MinIO (plus one-shot init)
	$(COMPOSE) up -d postgres redis minio minio-init migrate

down: ## Stop the stack (keep named volumes)
	$(COMPOSE) down

clean: ## Stop the stack and delete all data volumes
	$(COMPOSE) down -v --remove-orphans

ps: ## Show service status
	$(COMPOSE) ps

logs: ## Follow logs
	$(COMPOSE) logs -f --tail=200

build: ## Build all images
	$(COMPOSE) build

migrate: env ## Apply pending SQL migrations
	$(COMPOSE) run --rm migrate

seed: ## Create the demo admin/analyst/viewer users (Phase 1)
	POSTGRES_HOST=localhost REDIS_URL=redis://localhost:6379 MINIO_ENDPOINT=localhost npm run seed:demo

test: test-node test-ai ## Run all unit tests

test-node: ## Run frontend and gateway tests
	npm run test

test-ai: ## Run AI service tests
	cd services/ai && .venv/bin/python -m pytest

lint: ## Lint all code
	npm run lint
	cd services/ai && .venv/bin/ruff check app tests

typecheck: ## Typecheck all code
	npm run typecheck
	cd services/ai && .venv/bin/mypy app tests

format: ## Format all code
	npm run format
	cd services/ai && .venv/bin/ruff format app tests

format-check: ## Verify formatting without writing
	npm run format:check
	cd services/ai && .venv/bin/ruff format --check app tests

check: lint typecheck test ## Lint, typecheck and test

verify-roles: env ## Verify database role privileges (stack must be running)
	$(COMPOSE) run --rm verify-roles

audit: ## Audit Node and Python dependencies
	npm audit --audit-level=high
	cd services/ai && .venv/bin/pip-audit -r requirements.txt

eval: ## Run the evaluation harness (available from Phase 6)
	@echo "The eval harness is implemented in Phase 6. Datasets live in evals/datasets/."
	@exit 1
